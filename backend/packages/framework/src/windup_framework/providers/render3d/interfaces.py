"""三渲二三段能力的 provider 接口契约(三渲二版的 ``framework/providers/interfaces.py``)。

搬进产品仓时,本文件的三个 Protocol 与两个 port 直接并入
``backend/packages/framework/src/windup_framework/providers/interfaces.py``,
实现并入同目录的 ``tencent3d.py`` / ``sprite.py``。故这里**不 import 管线仓任何模块**。

三段:

    Model3DProvider      母版图 bytes  → 3D 模型 bytes        (云,按次计费)
    AutoRigProvider      3D 模型 bytes → 绑骨模型 bytes + 动作 (云,按次计费)
    SpriteRenderProvider 绑骨模型 bytes → 各朝向序列帧 bytes   (本地,零成本)

**入参恒为 bytes,不是 URL / 路径** —— 照抄 :class:`VideoProvider` 立下的约定:
上游手里只有 bytes,让每个调用点自己想办法弄一个公网 URL,会把"对象存储"扩散到
整条管线。绑骨接口(``SubmitAutoRiggingJob``)的 ``File3D.Url`` **只吃公网 URL、
不吃 base64**,那是 :class:`AutoRigProvider` 实现自己的适配问题:它在构造时接一个
:class:`ModelUploader`,在 provider 内部把 bytes 换成 URL。与 ``FalQueueVideoProvider``
接 ``FirstFrameUploader`` 完全同构。

出参同理:序列帧是 PNG bytes 而不是"一个目录",provider 不替调用方决定落盘位置。
"""
from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from typing import Protocol, runtime_checkable

__all__ = [
    "Model3DProvider", "AutoRigProvider", "SpriteRenderProvider", "ModelUploader",
    "PresetMotion", "RiggedModel", "SpriteSequence", "SpriteSheet", "RigInfo",
    "ModelRejectCode", "ModelRejected", "ArtifactFormatError", "ModelNotPublicError",
    "JobFailedError", "JobTimeoutError", "InsufficientCreditsError", "RenderStageError",
    "MODEL_FORMATS",
]

# 接口两端都只认这两种容器格式(``File3D.Type`` 的取值域)。
MODEL_FORMATS = ("GLB", "FBX")

# 出帧画布默认竖屏 1536×2560(2026-08-11 实测定的口径)。
# 旧默认 1107×924 是横的,而角色是竖长的:主体只有 193×668,宽度浪费 82%。
# 同一模型同一动作只改画布,主体 193×668 → 512×1772(2.65 倍),而单帧耗时 2.5~2.6 秒
# 几乎不变 —— 提分辨率是纯赚。"糊"的根因是画布太小,不是渲染质量差。
# (与 i2v 那条线同一个病:横屏 1280×720 卡死竖长角色的高度,改竖屏后主体 157px→322px。)
RENDER_SIZE = (1536, 2560)



# ── 出错形态 ────────────────────────────────────────────────────────────────
# 分得这么细不是洁癖:这条线上"看起来一样、修法完全不同"的失败太多了 ——
# 积分不够(充值)、姿势不对(换母版)、产物格式不符(改取件逻辑)、任务超时(可能已计费)。
# 全塞进 RuntimeError 就等于把这四种病压成一个症状,而这正是本仓吃过亏的地方。


class ModelRejectCode:
    """入口预检的拒绝原因。取值是稳定字符串,可进日志 / 进 API 响应。"""

    UNREADABLE = "unreadable"          # 解不开的 bytes / 不是 GLB 也不是 FBX
    TOO_LARGE = "too_large"            # 超过接口 60MB 上限
    NOT_A_POSE = "not_a_pose"          # 几何上明显不是 A/T-Pose(单侧判据,见 checks)
    HAS_ACCESSORY = "has_accessory"    # 检出人体以外的独立网格(弱信号,见 checks)


class ModelRejected(Exception):
    """送检模型不满足绑骨接口的硬约束 —— **在提交(花钱)之前**抛。

    为什么必须是入口异常而不是下游报错:这三条硬约束(≤60MB / A-T-Pose / 无武器配件)
    **违反了不会报错,只会默默产出错结果**(实测:带剑的模型,剑被绑上权重、动画里
    到处乱甩;整单钱已经花完才发现)。与 ``ai_engine.master_check`` 对母版做入口预检
    是同一个动作,理由也是同一个。
    """

    def __init__(self, code: str, message: str) -> None:
        super().__init__(f"[{code}] {message}")
        self.code = code
        self.message = message


class ArtifactFormatError(RuntimeError):
    """接口返回的产物格式与请求的不符 —— 拒绝当成功。

    2026-08-05 实测:请求 GLB 输入,返回的 ``ResultFile3Ds[0]`` 是 **FBX**,被按 ``.glb``
    存下,于是 Blender 报 "Bad glTF: json error: utf-8"、出帧台 waitForFunction 直接超时,
    排查方向被带到"出帧管线坏了"。管线里的修法是按后缀挑 + 挑不到就改文件名;
    **bytes 进 bytes 出的接口没有文件名可改**,所以这里的修法是:按 Type 挑,挑不到就抛,
    并且落地前再用 magic bytes 复核一次 —— ``Type`` 是供应商的自述,magic 是事实。
    """


class ModelNotPublicError(RuntimeError):
    """uploader 没给出 http(s) 公网 URL —— 绑骨服务器取不到这个模型。

    与 ``FirstFrameNotPublicError`` 同理:本地路径 / dataURI 在这一面必然产不出正确结果,
    宁可在提交前炸,也不要提交一个注定失败(但照样占用配额)的任务。
    """


class JobFailedError(RuntimeError):
    """云端任务返回失败终态,或返回了认不出的状态。

    认不出的状态一律当失败,不 continue —— 那会一直转到超时,把"协议变了"伪装成"生成太慢"。
    """


class JobTimeoutError(RuntimeError):
    """轮询预算耗尽仍未出结果(任务可能还在跑,**积分可能已经扣了**)。"""


class InsufficientCreditsError(RuntimeError):
    """账户积分不足(``ResourceInsufficient``)。

    单拎出来是因为它极易被误判成"接口坏了" —— 报错文本长得跟其他业务错误一样,
    但修法是充值,不是改代码。见过一次照着接口文档翻半天的。
    """


class RenderStageError(RuntimeError):
    """本地出帧台失败(node / 浏览器 / 页面脚本)。零成本段,失败可以随便重试。"""


# ── 值对象 ──────────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class PresetMotion:
    """绑骨接口自带的一个预设动作。

    ``has_root_motion`` 恒为 ``False`` 且不是留白:48 个预设**全部是纯旋转的原地动画**,
    跑步、向前大跳实测根位移都是 0。所以 ``root_motion`` / ``move_speed`` 在这条来源上
    **没有源数据**,只能由管线在图像空间量出来或人工设定 —— 别指望接口给。
    """

    name: str
    motion_type: int
    has_root_motion: bool = False


@dataclass(frozen=True)
class RiggedModel:
    """绑骨产物。

    比"一坨 bytes"多出来的两样都是调用方必须知道、而 bytes 本身不带的:
    ``fmt`` 是 **magic bytes 验过的真实格式**(不是接口自述的 Type),``motion`` 是这次
    烘进模型的预设动作(没请求动作时为 ``None``)。
    """

    data: bytes
    fmt: str
    motion: PresetMotion | None = None

    def __post_init__(self) -> None:
        if self.fmt not in MODEL_FORMATS:
            raise ArtifactFormatError(f"fmt 只能是 {MODEL_FORMATS},收到 {self.fmt!r}")


@dataclass(frozen=True)
class RigInfo:
    """出帧台从模型里读到的骨架事实。用于交付前核对,不参与渲染。

    已确立(不必每次重验):自动绑骨产出 **28 骨** · humanoid 命名 · **无 ``mixamorig:`` 前缀**。
    对不上说明拿到的不是我们这条链路的产物,该停下来看,而不是接着渲。
    """

    bones: int
    skinned_meshes: int
    vertices: int
    root_bone: str | None
    loader: str


@dataclass(frozen=True)
class SpriteSequence:
    """一个朝向的一条序列帧。

    ``direction`` 的取值域与前端导出模型的 ``ExportAction.sequences[].direction`` 一致
    (e / ne / n / nw / w / sw / s / se),**不需要转换层**。
    """

    direction: str
    camera_yaw: float
    frames: Sequence[bytes] = field(repr=False)

    def __len__(self) -> int:
        return len(self.frames)


@dataclass(frozen=True)
class SpriteSheet:
    """一次出帧的全部产物。

    ``root_motion`` 是出帧台在**归一化单位**(1.0 = 角色总高)下从根骨位置轨抽出来的水平
    位移;走绑骨预设动作时它恒为 0(见 :class:`PresetMotion`)。留着这个字段是因为同一个
    出帧台也吃外部动画(Mixamo 等),那些是带位移的。
    """

    clip: str
    duration_s: float
    sample_times: Sequence[float]
    sequences: Sequence[SpriteSequence]
    rig: RigInfo
    available_clips: Mapping[str, float]
    root_motion: Mapping[str, object] | None = None

    @property
    def frame_count(self) -> int:
        return sum(len(s) for s in self.sequences)


# ── port ────────────────────────────────────────────────────────────────────


@runtime_checkable
class ModelUploader(Protocol):
    """3D 模型 bytes → **公网可取的 URL**(给只吃 URL 的绑骨接口用)。

    与 :class:`FirstFrameUploader` **形状完全相同、契约不同**,故单列:

      - 体量差一个量级(几十 MB 的模型 vs 一张首帧图),对象存储的分片 / 超时策略不一样;
      - 有效期要求不同:URL 必须在**整个绑骨任务周期内**可取(排队 + 绑骨,实测 40–60s,
        但排队可能更久),不是发出去就完事;
      - 返回的 URL 常常带签名(预签名 URL 里含 SecretId 与 signature),
        **调用方不得把它写进日志 / 错误文本**。

    形状保持一致是有意的:产品仓里两个 port 可以共用同一批 uploader 实现。
    """

    def upload(self, model: bytes, content_type: str) -> str: ...


# ── 三个 Protocol ───────────────────────────────────────────────────────────


@runtime_checkable
class Model3DProvider(Protocol):
    """母版图 bytes → 3D 模型 bytes(图生 3D)。

    **按次计费**。生成模式的积分是 provider 的构造参数,报价见实现的 ``quote()``;
    调用方要报价、要有人点头,不要在循环里跑。

    ``want`` 是**保证**不是偏好:拿不到该格式就抛 :class:`ArtifactFormatError`,
    绝不返回另一种格式的 bytes(bytes 没有后缀可以说谎,也就没有地方能纠正)。
    """

    def image_to_3d(
        self,
        master: bytes,
        *,
        want: str = "GLB",
        extra_views: Mapping[str, bytes] | None = None,
    ) -> bytes: ...


@runtime_checkable
class AutoRigProvider(Protocol):
    """3D 模型 bytes → 绑好骨的模型 bytes(+ 这次烘进去的预设动作)。

    **按次计费**(10 积分/次,每角色一次性)。

    实现在构造时接一个 :class:`ModelUploader` —— 接口的 ``File3D.Url`` 只吃公网 URL,
    但那是 provider 自己的适配问题,不外泄到调用方(见模块 docstring)。

    ``model`` 的格式由 magic bytes 嗅,不由调用方声明:嗅探是零成本且**不可能与事实矛盾**,
    而一个 ``fmt=`` 参数可以填错,填错的后果是提交一个注定产出错结果的任务。
    """

    @property
    def preset_motions(self) -> Mapping[str, PresetMotion]:
        """可请求的预设动作名 → 定义。全部 ``has_root_motion=False``。"""
        ...

    def rig(
        self,
        model: bytes,
        *,
        want: str = "GLB",
        motion: str | int | None = None,
    ) -> RiggedModel: ...


@runtime_checkable
class SpriteRenderProvider(Protocol):
    """绑骨模型 bytes + 动作 + 朝向 → 各朝向序列帧 bytes。

    **本地跑,零 API 成本** —— 这是三渲二相对逐帧 / 视频路线的主要杠杆:模型与动作都不变,
    只换相机方位角重渲一遍,各朝向天生一致(同一网格、同一骨骼、同一采样时刻)。
    逐帧 / 视频路线做同样的事是 N 倍生成费用,且各朝向之间没有一致性保证。

    ``directions`` 只接受 4 或 8(8 向是 4 向的超集)。``material`` 必须是出帧台**真正认识**
    的取值,实现会校验 —— 详见 :mod:`.sprite` 里 ``MATERIALS`` 的注释。
    """

    def render(
        self,
        rigged_model: bytes,
        *,
        clip: str | None = None,
        directions: int = 4,
        frames: int = 12,
        size: tuple[int, int] = RENDER_SIZE,
        material: str = "cel",
    ) -> SpriteSheet: ...
