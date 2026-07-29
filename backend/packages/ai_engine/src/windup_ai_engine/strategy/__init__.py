"""strategy:动作 → 生成路线分流(ROUTE_MATRIX)+ 三条 DerivationStrategy。"""

from .base import ROUTE_MATRIX, DerivationStrategy
from .concrete import PerFrameStrategy, ProcIdleStrategy, VideoFrameStrategy

__all__ = [
    "ROUTE_MATRIX",
    "DerivationStrategy",
    "VideoFrameStrategy",
    "PerFrameStrategy",
    "ProcIdleStrategy",
]
