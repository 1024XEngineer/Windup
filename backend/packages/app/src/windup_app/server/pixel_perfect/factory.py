"""完美像素工具在应用 composition root 使用的本地装配。"""

from windup_app.server.pixel_perfect.native import (
    NativeGridDetector,
    NativeGridReconstructor,
)
from windup_app.server.pixel_perfect.service import PixelPerfectTool


def create_pixel_perfect_tool(*, max_concurrency: int) -> PixelPerfectTool:
    return PixelPerfectTool(
        detector=NativeGridDetector(),
        reconstructor=NativeGridReconstructor(),
        max_concurrency=max_concurrency,
    )
