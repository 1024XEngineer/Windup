"""完美像素工具在应用 composition root 使用的本地装配。"""

import os

from windup_app.server.pixel_perfect.native import (
    NativeGridDetector,
    NativeGridReconstructor,
)
from windup_app.server.pixel_perfect.service import PixelPerfectTool


def create_pixel_perfect_tool() -> PixelPerfectTool:
    timeout_seconds = float(os.getenv("PIXEL_PERFECT_TIMEOUT_SECONDS", "30"))
    max_concurrency = int(os.getenv("PIXEL_PERFECT_CONCURRENCY", "1"))
    detector_bin = os.getenv("PIXEL_GRID_DETECTOR_BIN", "windup-pixel-grid-detector")
    reconstructor_bin = os.getenv(
        "PIXEL_GRID_RECONSTRUCTOR_BIN", "windup-pixel-grid-reconstructor"
    )
    return PixelPerfectTool(
        detector=NativeGridDetector((detector_bin,), timeout_seconds=timeout_seconds),
        reconstructor=NativeGridReconstructor(
            (reconstructor_bin,), timeout_seconds=timeout_seconds
        ),
        max_concurrency=max_concurrency,
    )
