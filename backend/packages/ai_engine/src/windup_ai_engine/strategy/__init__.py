"""strategy:动作 → 生成路线分流(ROUTE_MATRIX)+ 各条 DerivationStrategy。"""

from .base import CYCLIC_ACTIONS, ROUTE_MATRIX, DerivationStrategy
from .concrete import PerFrameStrategy, RenderFrameStrategy, VideoFrameStrategy

__all__ = [
    "ROUTE_MATRIX",
    "CYCLIC_ACTIONS",
    "DerivationStrategy",
    "VideoFrameStrategy",
    "PerFrameStrategy",
    "RenderFrameStrategy",
]
