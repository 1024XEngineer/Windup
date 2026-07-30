"""后处理:把选好的帧落地成交付级序列帧(像素化 / 对齐 / 打包)。

抽帧 / 选帧见 :mod:`..slicing`。逐帧时长 ``frame_durations`` 在 :mod:`.rootmotion`。
"""

from .rootmotion import DEFAULT_FPS_MS, extract_root_motion, frame_durations
from .pixelate import (
    detect_pixel_size,
    extract_palette,
    master_pixel_spec,
    pixelate_frames,
    to_pixel_art,
)
from .pack import align_bottom_center, save_gif, sprite_sheet

__all__ = [
    "to_pixel_art",
    "pixelate_frames",
    "detect_pixel_size",
    "extract_palette",
    "master_pixel_spec",
    "extract_root_motion",
    "frame_durations",
    "DEFAULT_FPS_MS",
    "align_bottom_center",
    "sprite_sheet",
    "save_gif",
]
