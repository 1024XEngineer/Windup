"""媒体资产领域模型。"""

from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import StrEnum
from typing import Any


# -- 枚举 ----------------------------------------------------------------

class MediaType(StrEnum):
    """媒体类型——每新增一种媒体格式，在此加一个成员。"""

    IMAGE = "image"
    VIDEO = "video"
    AUDIO = "audio"
    MODEL_3D = "model_3d"


class DerivativeKind(StrEnum):
    """加工产物类型。"""

    THUMBNAIL = "thumbnail"
    PREVIEW = "preview"            # GIF / 短视频预览
    TRANSCODED = "transcoded"      # 转码后（兼容播放）
    WAVEFORM = "waveform"          # 音频波形


# -- 加工选项（策略各自持有自己的选项模型）-------------------------------

@dataclass
class ImageProcessOptions:
    """图片加工选项。"""

    width: int | None = None
    height: int | None = None
    format: str | None = None       # jpg / png / webp
    quality: int = 85


@dataclass
class VideoProcessOptions:
    """视频加工选项。"""

    width: int | None = None
    height: int | None = None
    format: str | None = None       # mp4 / webm
    fps: int | None = None
    generate_gif_preview: bool = False


@dataclass
class AudioProcessOptions:
    """音频加工选项。"""

    format: str | None = None       # mp3 / ogg / wav
    bitrate: int | None = None      # kbps
    generate_waveform: bool = False


@dataclass
class Model3DProcessOptions:
    """3D 模型加工选项。"""

    format: str | None = None       # glb / gltf / fbx
    render_thumbnail: bool = True
    thumbnail_width: int = 512
    thumbnail_height: int = 512


# -- 加工产物 ------------------------------------------------------------

@dataclass
class Derivative:
    """单个加工产物。"""

    kind: DerivativeKind
    url: str
    format: str = ""
    width: int | None = None
    height: int | None = None
    file_size: int | None = None


# -- 媒体记录 ------------------------------------------------------------

@dataclass
class MediaRecord:
    """媒体资产（贯穿上传→加工→使用全生命周期）。"""

    id: int | None = None
    project_id: int | None = None
    user_id: int = 0
    media_type: MediaType = MediaType.IMAGE
    original_url: str = ""
    original_name: str = ""
    file_size: int = 0
    derivatives: list[Derivative] = field(default_factory=list)
    metadata: dict[str, Any] = field(default_factory=dict)
    create_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    update_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))