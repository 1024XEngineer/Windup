"""三渲二三段能力的 provider —— **产品侧 Protocol 形状**,为整体搬进产品仓准备。

    母版图 bytes ──Model3DProvider──▶ 3D 模型 bytes ──AutoRigProvider──▶ 绑骨模型 bytes
                                                                            │
                                                        SpriteRenderProvider │
                                                                            ▼
                                                        各朝向序列帧 PNG bytes

对应产品仓的落点(搬过去时是拆分而不是重写):

    interfaces.py  →  framework/providers/interfaces.py   (三个 Protocol + ModelUploader port)
    tencent.py     →  framework/providers/tencent3d.py    (两个计费实现 + COS uploader)
    sprite.py      →  framework/providers/sprite3d.py     (本地出帧实现)
    checks.py      →  ai_engine/model_check.py            (与 master_check 并列的入口预检)
    _tc3.py        →  产品仓若已有腾讯云凭证层则整份替换

**本包不 import 管线仓任何模块**,依赖只有标准库 + 出帧段的 node/three/playwright。
"""
from ._tc3 import TencentApiError, TencentCredentials, redact
from .checks import ModelFacts, check_model, sniff_format
from .interfaces import (
    RENDER_SIZE,
    ArtifactFormatError,
    AutoRigProvider,
    InsufficientCreditsError,
    JobFailedError,
    JobTimeoutError,
    Model3DProvider,
    ModelNotPublicError,
    ModelRejectCode,
    ModelRejected,
    ModelUploader,
    PresetMotion,
    RenderStageError,
    RigInfo,
    RiggedModel,
    SpriteRenderProvider,
    SpriteSequence,
    SpriteSheet,
)
from .sprite import DIRECTIONS_4, DIRECTIONS_8, MATERIALS, LocalSpriteRenderProvider
from .tencent import (
    PRESET_MOTIONS,
    SpendNotAuthorizedError,
    TencentAutoRigProvider,
    TencentCosModelUploader,
    TencentModel3DProvider,
)

__all__ = [
    "RENDER_SIZE",
    # 契约
    "Model3DProvider", "AutoRigProvider", "SpriteRenderProvider", "ModelUploader",
    "PresetMotion", "RiggedModel", "SpriteSequence", "SpriteSheet", "RigInfo",
    "ModelFacts", "ModelRejectCode",
    # 实现
    "TencentModel3DProvider", "TencentAutoRigProvider", "TencentCosModelUploader",
    "LocalSpriteRenderProvider",
    # 预检 / 常量
    "check_model", "sniff_format", "PRESET_MOTIONS", "DIRECTIONS_4", "DIRECTIONS_8",
    "MATERIALS", "TencentCredentials", "redact",
    # 出错形态
    "ModelRejected", "ArtifactFormatError", "ModelNotPublicError", "JobFailedError",
    "JobTimeoutError", "InsufficientCreditsError", "RenderStageError",
    "SpendNotAuthorizedError", "TencentApiError",
]
