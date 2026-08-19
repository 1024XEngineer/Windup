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

from windup_common.models import (
    ActionSpec,
    CharacterCard,
    CharacterStance,
    Facing,
    JudgeVerdict,
)

from windup_ai_engine.prompt.lint import Kind, LintIssue


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


class MasterWarningCode(str, Enum):
    """母版**可疑但不足以拒**的形态 —— 判据本身是近似的,误拒的代价高于漏放。

    与 :class:`MasterRejectCode` 的分工由**判据能不能证伪**决定,不由后果严重程度决定:
    拒绝码那几条量到就是事实(解不开、没主体、比例超限);警告码这几条量到的是相关信号,
    合法母版也可能命中(见 :mod:`windup_ai_engine.master_check` 各条的假阳性来源)。
    """

    LIMBS_FUSED = "limbs_fused"            # 下半身横切只有一段:双腿可能粘连
    EXTRA_COMPONENT = "extra_component"    # 主体之外还有独立色块:可能是手持物/道具/标注


@dataclass(frozen=True)
class MasterWarning:
    """一条警告。``code`` 给上层做分支,``detail`` 给人看。"""

    code: MasterWarningCode
    detail: str


class MasterRejected(ValueError):
    """母版不具备可生成性,在**调用付费模型之前**拒绝。

    与 ai_engine 其他异常的分工(这条分工是给 server 用的):
      - ``MasterRejected`` / ``PromptRejected`` = **调用方的输入不行**,同一份输入
        重试多少次都一样。server 应映射成 4xx、按 ``code`` 选"换一张母版" /
        "改一下这句描述"的文案,**不要重试**。
      - ``NotImplementedError`` / 其他 ``ValueError`` = 引擎侧装配或产出出了问题
        (路线没注入、strategy 吐空帧、帧数对不上),属于 5xx、要人介入,
        让用户换母版是把锅甩错地方。
    """

    def __init__(self, code: MasterRejectCode, detail: str) -> None:
        super().__init__(f"母版不可用({code.value}):{detail}")
        self.code = code
        self.detail = detail


class PromptRejectCode(str, Enum):
    """用户那句动作描述被拒的原因 —— server 据此选文案,别 parse 异常消息做分支。

    每个取值对应一条**模型侧的机制**(见 :mod:`windup_ai_engine.prompt.lint`),
    不是文风偏好;判定全部本地零成本,发生在付费调用之前。
    """

    EMPTY = "empty"                        # 没写动作:模型照跑,回来一段站着不动的视频
    TOO_LONG = "too_long"                  # 越长越容易夹带外观,而外观由母版承载
    NEGATION = "negation"                  # 无 negative_prompt,"不要 X"把 X 送进画面
    HAZARD_NOUN = "hazard_noun"            # 特效名词盖住轮廓,抠图留脏边
    SHAPE_PRIOR = "shape_prior"            # 断言母版里没有的装备形状,焊到角色身上
    SUBTHRESHOLD = "subthreshold"          # 幅度低于模型可控分辨率 → 逐帧随机抖
    UNANCHORED_PROP = "unanchored_prop"    # 没交代身体整体怎么动,手里的东西自行漂移
    MULTI_STAGE = "multi_stage"            # 静态模型没有时间轴,多阶段摊成分解姿势图
    STANCE_MISMATCH = "stance_mismatch"    # 非双足角色写人体部位 → 凭空长出人的上肢


class PromptRejected(ValueError):
    """这段描述送进模型必然出坏产物,在**调用付费模型之前**拒绝。

    形状与 :class:`MasterRejected` 一致、分工同一条:它是**调用方输入不行**那一类,
    server 映射 4xx 让用户改那句话,而不是 5xx 报"系统出问题了"——用户改得动的东西
    被报成服务器故障,他只会重试同一句话。

    多条机制同时命中时 ``code`` 取报告序里的第一条,``detail`` 仍把每条都列出来:
    只讲一条会让用户改完再被下一条拦一次。
    """

    def __init__(self, code: PromptRejectCode, detail: str) -> None:
        super().__init__(f"这段描述跑不出可用产物({code.value}):{detail}")
        self.code = code
        self.detail = detail


# ---- 用户大白话 → 正式提示词(实现在别处,见下)----
@dataclass(frozen=True)
class AdaptedPrompt:
    """一次**成功**适配的结果 —— 拿到它就等于可以往下送。

    不可适配走 :class:`PromptRejected`,不在这里留一个"拒了"的字段:同一件事两条返回
    路径,调用方得写两套处理,而漏写返回值那条是静默的 —— 空文本照样进付费调用。
    """

    text: str
    """正式提示词。

    ``kind="i2v"`` 时它**不含**循环性尾句:循环与否是请求的属性(``ActionSpec.cyclic``),
    适配器的入参里没有,替调用方猜一条会把一次性动作首尾闭环,而帧数 / 时长 / 成色全正常。
    调用方按自己声明的循环性追加 ``prompt.custom`` 的两条尾句之一。
    """

    issues: tuple[LintIssue, ...] = ()
    """确定性改写做不到、但不足以拦下的问题(warn 级)。error 级都走拒绝,不会到这里。"""


class PromptAdapterPort(Protocol):
    """把用户那句大白话改写进已验证的骨架。

    引擎侧只定协议:确定性规则之外的改写要调模型,那属于 provider 那一层。

    Args:
        user_text: 用户自述的动作,只讲做什么动作。
        kind: 目标模型类型 —— 决定哪些规则成立(见 ``prompt.lint`` 的 ``kind``)。
        facing: 母版朝向。**必须与母版一致**。
        stance: 角色体型(``CharacterCard.stance``)。非双足时"手臂"一类词会让模型
            凭空长出人的上肢,故它参与判定,不只是记录。

    Raises:
        PromptRejected: 这段描述送进模型必然出坏产物 → 4xx,让用户改这句话。
    """

    def adapt(
        self,
        user_text: str,
        *,
        kind: Kind,
        facing: Facing,
        stance: CharacterStance,
    ) -> AdaptedPrompt: ...


# ---- ai_engine 出参(不含存储引用:上传 / 落库在 server 侧)----
@dataclass(frozen=True)
class ActionQuality:
    """这一次出帧的成色 —— 让上层能判"交付 / 重试 / 让用户换母版"。

    没有这个,``GeneratedAction`` 只能表达"生成完了",不能表达"生成得怎么样":
    一段**每帧都一样**的 walk 和一段步态干净的 walk,帧数、时长、fps 完全相同,
    调用方分辨不出 —— 本仓吃过四次的正是这类"看起来成功的错结果"。

    四个字段各自不可由其余推导(下面逐条说明必要性)。刻意**没有**的字段:
      - 糊帧率(``slicing.quality.blur_ratio``):2026-08-05 实测 6 段真 i2v
        **没有一帧糊帧**,加进来是个恒等于 1 的常数,上层拿它做不了任何决定。
        真出现糊帧再加,那时才有阈值可依。
      - 抽帧降级原因(``slicing.pick_cycle`` 的三条退化路径):见该函数 docstring 里
        记的缺口。降级**对交付物的后果**由 ``loop_seam`` 直接测得,而"降级的原因"
        今天没有任何调用方会据此改变行为,故不塞进出参。
    """

    limbs: dict[str, float] = field(default_factory=dict, kw_only=True)
    """分区动量(``slicing.quality.limb_motion``):``{区名: 占比}`` + 最静区名 ``still``。

    补 ``motion_scale`` / ``dead_frames`` 的共同盲区 —— 那两个看的是**整幅**,而
    "腿在迈、手臂僵成柱子"整幅指标完全正常。某个该动的区占比接近 0 = 那块网格没被
    骨骼驱动(多半是自动绑骨漏认了肢体),别交付。
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

    subject_blobs: tuple[int, ...]
    """逐帧的"够大"连通块数(alpha>128,4-邻域;见 ``slicing.quality.subject_blobs``)。

    上层拿它做的决定:全程恒为 2(或更多)→ 母版/提示词让引擎画出了第二个角色,
    提示重试或换母版,这类病 ``motion_scale``/``dead_frames``/``loop_seam`` 全部
    测不出——三者都只看"帧与帧之间变了多少",一个稳定存在的额外主体不影响它们
    任何一个读数。只在中段冒出的 2 是另一类病(挥动的肢体/道具被抠断),修法是
    调抠图阈值而非换母版,与前者必须分开看,故给逐帧序列而非一个均值。
    """


@dataclass
class GeneratedAction:
    """一个动作的生成产物:对齐后的原地序列帧 + 逐帧时长 + 成色 + 提示词版本。

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
    # 同一条理由:不给缺省,逼调用方显式带出当下的 ``windup_ai_engine.prompt.PROMPT_VERSION``。
    # 改了提示词模板而没带上新版本号,这批产出与改动前的产出在账本里就再也分不清。
    prompt_version: str = field(kw_only=True)


# ---- 出门那道闸的仪器:判官(server 注入实现,framework 层有一个)----
# 与 ``ActionQuality`` 分工不同:那三个数由本地像素算出来,零成本、量的是帧**之间**的
# 关系;判官量的是一帧画面**里**有什么,要花一次付费调用,且本地算不出来 —— 像素统计
# 分不出"两个角色"和"一个角色 + 一件道具"。
@runtime_checkable
class JudgePort(Protocol):
    """交付帧 + 母版 → 四个可数读数(:class:`JudgeVerdict`)。

    读不出结论必须抛错,不得兜底成"通过":静默放行会让"没判"与"判了没问题"在下游
    长得一样。``master`` 必填 —— "有没有母版里没有的物体"离开母版无从回答。
    """

    def judge(self, frame: bytes, master: bytes, action: str) -> JudgeVerdict: ...


# ---- ai_engine 暴露给 server(server 调用的唯一入口)----
@runtime_checkable
class CharacterGeneratorPort(Protocol):
    """生成入口:角色卡 + 动作规格 + 母版 → 帧序列产物。

    不关心租户 / 配额 / 任务状态 / 存储(那些在 app.server)。

    Args:
        card: 角色卡。视频路线**只读 ``stance`` 一个字段**,且它不进提示词、只决定用户那句
            描述里的人体部位词(手臂 / 手肘)放不放行 —— 非双足角色放行了,模型会给它接上
            一对人的上肢。**角色身份不读 card**:i2v 的一致性完全由 ``master`` 这张母版图像
            承载,身份描述再写一遍反而会和母版打架。其余字段是给未实现路线预留的:逐帧图生图
            (#53)要靠 ``name`` / ``desc`` 在每帧提示词里锁一致性,渲染出帧(#81 #122)要靠
            ``master_ref`` / ``version`` 定位 3D 资产。**改 name / desc 影响不了视频路线的产出。**
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
        PromptRejected: ``action=custom`` 时用户那句描述必然出坏产物(见
            :class:`PromptRejectCode`)。同样在花钱之前抛 → 4xx、请用户改那句话。
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

    def generate_rendered(
        self,
        card: CharacterCard,
        action: ActionSpec,
        rigged_model: bytes,
        progress: ProgressPort,
        canvas: tuple[int, int] | None = None,
    ) -> GeneratedAction:
        """三渲二:拿**已绑骨的 3D 模型**套预设动作、渲成 2D 序列帧。

        与 :meth:`generate` 并列而不另立 port —— server 调 ai_engine 只该有一个入口。
        **调哪个由 server 决定,引擎不选**:判据"该造型有没有 3D 资产"只有 DB 知道
        (``character_data.outfits[].model_3d_url``),故本方法不提供"能不能用"的预查询。
        ``rigged_model`` 传 bytes 不传 URL —— ai_engine 只吃 bytes、不碰存储;取模型与
        **建**模型那笔按次计费都在 server 侧,不在这条出帧路径上。

        Raises:
            NotImplementedError: 没注入 ``GenRoute.RENDER_3D`` 的 strategy。
            ValueError: 模型渲不出请求朝向 / 产出帧数对不上契约。
        """
        ...


@runtime_checkable
class CharacterNamerPort(Protocol):
    """根据角色描述生成短名称。不是 Agent，只是一次 LLM 调用。"""

    def name_from_description(self, description: str) -> str: ...
