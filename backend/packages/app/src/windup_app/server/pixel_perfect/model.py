"""完美像素工具在检测、重建与 API 之间传递的最小契约。"""

from dataclasses import dataclass


@dataclass(frozen=True)
class GridDetection:
    cols: int
    rows: int
    step_x: float
    step_y: float
    consensus: str
    confidence: str


@dataclass(frozen=True)
class PixelPerfectResult(GridDetection):
    png: bytes
