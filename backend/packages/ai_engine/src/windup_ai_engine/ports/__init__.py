"""ai_engine 对外契约(ports)—— server 只 import 这里,不碰 slicing / strategy / impl。

CI 的 import-linter 分层门禁会强制:app.server 依赖只到 ai_engine.ports。
换掉内部实现(strategy / provider)时 server 零改动。

MVP 边界(与作者对齐):ai_engine **只产出帧 bytes + 进度**,不碰存储 / DB。
母版(master)由 server 侧从 ``Character.reference_image_url`` 取好、以 bytes 传入;
产出的帧由 server 侧上传对象存储、落 ``character_data``。故本层无 ArtifactStore 依赖。
"""
from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Protocol, runtime_checkable

from windup_common.models import ActionSpec, CharacterCard


# ---- server 实现、注入给 ai_engine 的进度回调 port ----
class ProgressPort(Protocol):
    """进度上报 —— server 转 SSE / 轮询状态(取代管线里的 print)。"""

    def step(self, stage: str, i: int, total: int, note: str = "") -> None: ...


# ---- 入口拒绝(在花钱之前)----
class MasterRejectCode(str, Enum):
    """母版被拒的原因 —— server 据此选文案,别用异常消息做分支(消息会改)。

    取值全部是**本地零成本可判**的形态问题;判不了的(画的是不是角色、朝向对不对)
    不在此列,见 :mod:`windup_ai_engine.master_check` 的"本层不判什么"。
    """

    UNDECODABLE = "undecodable"              # 不是图 / 截断 / 编码不支持
    NO_SUBJECT = "no_subject"                # 全透明或全同色:没有可动的东西
    SUBJECT_TOO_SMALL = "subject_too_small"  # 主体小到与噪点/水印无从区分
    ASPECT_TOO_WIDE = "aspect_too_wide"      # 主体太扁,方形 cell 里只能压成一条


class MasterRejected(ValueError):
    """母版不具备可生成性,在**调用付费模型之前**拒绝。

    与 ai_engine 其他异常的分工(这条分工是给 server 用的):
      - ``MasterRejected`` = **调用方的输入不行**,同一张母版重试多少次都一样。
        server 应映射成 4xx、把 ``code`` 翻成"请换一张母版"类文案,**不要重试**。
      - ``NotImplementedError`` / 其他 ``ValueError`` = 引擎侧装配或产出出了问题
        (路线没注入、strategy 吐空帧、帧数对不上),属于 5xx、要人介入,
        让用户换母版是把锅甩错地方。
    """

    def __init__(self, code: MasterRejectCode, detail: str) -> None:
        super().__init__(f"母版不可用({code.value}):{detail}")
        self.code = code
        self.detail = detail


# ---- ai_engine 出参(不含存储引用:上传 / 落库在 server 侧)----
@dataclass(frozen=True)
class ActionQuality:
    """这一次出帧的成色 —— 让上层能判"交付 / 重试 / 让用户换母版"。

    没有这个,``GeneratedAction`` 只能表达"生成完了",不能表达"生成得怎么样":
    一段**每帧都一样**的 walk 和一段步态干净的 walk,帧数、时长、fps 完全相同,
    调用方分辨不出 —— 本仓吃过四次的正是这类"看起来成功的错结果"。

    三个字段各自不可由其他两个推导(下面逐条说明必要性)。刻意**没有**的字段:
      - 糊帧率(``slicing.quality.blur_ratio``):2026-08-05 实测 6 段真 i2v
        **没有一帧糊帧**,加进来是个恒等于 1 的常数,上层拿它做不了任何决定。
        真出现糊帧再加,那时才有阈值可依。
      - 抽帧降级原因(``slicing.pick_cycle`` 的三条退化路径):见该函数 docstring 里
        记的缺口。降级**对交付物的后果**由 ``loop_seam`` 直接测得,而"降级的原因"
        今天没有任何调用方会据此改变行为,故不塞进出参。
    """

    motion_scale: float
    """交付帧的相邻帧平均差异(48×48 灰度绝对尺度)。**0.0 = N 张同一张图。**

    上层拿它做的决定:接近 0 → 这不是动画,**不要交付**(退款 / 重试 / 提示母版
    姿态不适合该动作)。它与 ``dead_frames`` 不重复而是互补 —— ``dead_frames``
    的两条判据都是相对的(比邻居、比自身 p75),整段完全冻结时全部不成立、
    一帧死帧都报不出(见 ``slicing.quality.motion_scale`` 的实测说明)。
    """

    dead_frames: tuple[int, ...]
    """与前一帧几乎无变化的帧下标(下标 0 不参与判定:它没有前一帧)。

    上层拿它做的决定:``len(dead_frames)/len(frames)`` 偏高 → 用户花 N 帧的钱只拿到
    N-K 个不同姿态,提示重试或换母版。给**下标**而不是个数,是因为分布形态对应两种
    不同的病、修法不同:连续一段 = 动作停住(母版姿态不对 / 视频后半段衰减),
    隔帧散布 = 有效帧率减半(i2v 复制帧),前者换母版、后者调抽帧密度。
    """

    loop_seam: float | None
    """末帧接回首帧的跳幅 ÷ 相邻帧平均步长。1.0 ≈ 接缝与一个正常帧间步长同量级。

    上层拿它做的决定:循环类动作(idle/walk/run)会被引擎反复播放,接缝大就是肉眼
    可见的"跳一下";超过约 1.2 → 提示重试。取归一化值而不是原始差,是为了让不同
    动作幅度之间可比。

    ``None`` = **这个数在本次生成里不可读**,两种情形:一次性动作(jump/attack/hit)
    本就不闭环;或 ``motion_scale`` 为 0(整段静止,连"一个正常步长"都没有,归一化
    无从谈起)。调用方要区分就看 ``motion_scale``,**不要把 None 当 0.0** ——
    0.0 会被读成"完美闭环",正是本仓忌讳的"貌似合理的默认值"。
    """


@dataclass
class GeneratedAction:
    """一个动作的生成产物:对齐后的原地序列帧 + 逐帧时长 + 成色。

    frames / durations **等长**;server 侧把每帧上传对象存储得 URL,组成
    ``CharacterActionOutput.frames[{index, image_url, duration_ms}]`` 回填 character_data。
    """

    frames: list[bytes] = field(default_factory=list)   # RGBA PNG,按播放序
    # 播放时序的**唯一**真相源。曾另有一个 fps 字段抄自入参,与本字段互相矛盾:
    # fps=20 宣称 50ms/帧,而 walk 这里给的是 125ms/帧 —— 同一段素材两个播放速度,
    # 取哪个看消费方心情(2026-08-10 机器审 P2)。逐帧 ms 严格更能表达(关键帧定格),
    # 所以删 fps 保 durations;真要单一帧率,由消费方从本字段算。
    durations: list[int] = field(default_factory=list)  # 逐帧时长(ms),与 frames 等长
    # 无默认值、且 kw_only 让它能排在有默认值的字段之后:**不给"没测"留缺省**。
    # 给个 None 缺省的话,漏测与"测出来没问题"在调用方看来一模一样,而这个出参的
    # 全部意义就是把这两者分开。
    quality: ActionQuality = field(kw_only=True)


# ---- ai_engine 暴露给 server(server 调用的唯一入口)----
@runtime_checkable
class CharacterGeneratorPort(Protocol):
    """生成入口:角色卡 + 动作规格 + 母版 → 帧序列产物。

    不关心租户 / 配额 / 任务状态 / 存储(那些在 app.server)。

    Args:
        card: 角色卡。**当前唯一实现的视频路线一个字段都不读**——``git grep 'card\\.'``
            在 ai_engine 下零命中(2026-08-08 复核)。这不是遗漏:i2v 的角色身份完全由
            ``master`` 这张母版图像承载,身份描述再写一遍反而会和母版打架。本参数是给
            未实现路线预留的入参:逐帧图生图(#53)要靠 ``name`` / ``desc`` 在每帧提示词里
            锁一致性,渲染出帧(#81 #122)要靠 ``master_ref`` / ``version`` 定位 3D 资产。
            **调用方不要指望改 card 能影响视频路线的产出。**
        action: 动作规格(类型 / 帧数 / 风格化 / 朝向)。视频路线的实际入参在这里:
            ``action``、``n_frames``、``facing``、``stylize`` 等。
        master: 定妆母版图 bytes(server 从 reference_image_url 取)。**视频路线的
            角色一致性靠它,不靠 card。** 进付费模型之前会先过一遍可生成性预检,
            见 Raises。
        progress: 进度回调。
        canvas: 交付画布 ``(宽, 高)``,单位像素。``None`` = 引擎默认(256 方形)。
            **给上层传项目 sprite 尺寸用的。** 不给的话引擎恒出 256,上层要缩到项目
            尺寸就得再来一次重采样;而那一步用 ``Image.thumbnail``(只缩不放),放大
            方向根本不放大、还会把脚线从 0.92 挪到 0.709(2026-08-11 实测),角色不
            站在地上。让引擎一次出到目标尺寸,那次二次缩放就整个消掉。
            画布几何按比例定义,故任何尺寸下构图不变、母版预检阈值同样有效。

    Raises:
        MasterRejected: 母版形态不可生成(见 :class:`MasterRejectCode`)。**在花钱
            之前抛**,同一张母版重试无意义 → server 映射 4xx、请用户换母版。
        NotImplementedError: 该动作分流到的路线没有实现或没注入 strategy。
        ValueError: 产出对不上契约(空帧 / 帧数不足)。钱已经花了,但错产物不放行。

    出参的 ``GeneratedAction.quality`` 是**必填**的成色读数:帧数对、无异常并不
    等于产物可用,调用方交付前应据它决定交付 / 重试 / 让用户换母版。
    """

    def generate(
        self,
        card: CharacterCard,
        action: ActionSpec,
        master: bytes,
        progress: ProgressPort,
        canvas: tuple[int, int] | None = None,
    ) -> GeneratedAction: ...


@runtime_checkable
class CharacterNamerPort(Protocol):
    """根据角色描述生成短名称。不是 Agent，只是一次 LLM 调用。"""

    def name_from_description(self, description: str) -> str: ...
