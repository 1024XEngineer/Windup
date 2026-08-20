"""独立完美像素工具的编排边界。"""

from io import BytesIO
import math
from threading import BoundedSemaphore
from typing import Protocol

from PIL import Image, UnidentifiedImageError

from windup_app.server.pixel_perfect.errors import (
    PixelPerfectBusyError,
    PixelPerfectInputError,
    PixelPerfectUnavailableError,
)
from windup_app.server.pixel_perfect.model import GridDetection, PixelPerfectResult


class GridDetector(Protocol):
    def detect(self, source: bytes) -> GridDetection: ...


class GridReconstructor(Protocol):
    def reconstruct(
        self, source: bytes, *, cols: int, rows: int, colors: int
    ) -> bytes: ...


class PixelPerfectTool:
    def __init__(
        self,
        *,
        detector: GridDetector,
        reconstructor: GridReconstructor,
        max_concurrency: int = 1,
    ) -> None:
        self._detector = detector
        self._reconstructor = reconstructor
        if max_concurrency < 1:
            raise ValueError("max_concurrency must be at least 1")
        self._slots = BoundedSemaphore(max_concurrency)

    def process(
        self,
        source: bytes,
        *,
        colors: int,
        pixel_size: float | None,
    ) -> PixelPerfectResult:
        if not self._slots.acquire(blocking=False):
            raise PixelPerfectBusyError("完美像素工具正在处理另一张图片")
        try:
            width, height = _image_dimensions(source)
            if not 2 <= colors <= 64:
                raise PixelPerfectInputError("colors 必须在 2 到 64 之间")
            if pixel_size is None:
                grid = self._detector.detect(source)
                if grid.step_x < 3 or grid.step_y < 3:
                    raise PixelPerfectInputError(
                        "自动识别到的隐含像素小于 3px，请提供手动 pixel_size"
                    )
            else:
                if not math.isfinite(pixel_size) or pixel_size < 1:
                    raise PixelPerfectInputError("pixel_size 必须是大于等于 1 的有限数")
                cols = max(1, round(width / pixel_size))
                rows = max(1, round(height / pixel_size))
                grid = GridDetection(
                    cols=cols,
                    rows=rows,
                    step_x=width / cols,
                    step_y=height / rows,
                    consensus="forced",
                    confidence="forced",
                )
            if not (1 <= grid.cols <= width and 1 <= grid.rows <= height):
                raise PixelPerfectUnavailableError("检测器返回了超出图片范围的网格")
            png = self._reconstructor.reconstruct(
                source,
                cols=grid.cols,
                rows=grid.rows,
                colors=colors,
            )
            _validate_reconstruction(png, grid.cols, grid.rows)
            return PixelPerfectResult(
                png=png,
                cols=grid.cols,
                rows=grid.rows,
                step_x=grid.step_x,
                step_y=grid.step_y,
                consensus=grid.consensus,
                confidence=grid.confidence,
            )
        finally:
            self._slots.release()


def _image_dimensions(source: bytes) -> tuple[int, int]:
    if len(source) > 10 * 1024 * 1024:
        raise PixelPerfectInputError("图片不能超过 10 MB")
    try:
        with Image.open(BytesIO(source)) as image:
            width, height = image.size
            image_format = image.format
    except (
        Image.DecompressionBombError,
        Image.DecompressionBombWarning,
        UnidentifiedImageError,
        OSError,
    ) as error:
        raise PixelPerfectInputError("来源不是可解码的图片") from error
    if image_format not in {"PNG", "JPEG"}:
        raise PixelPerfectInputError("当前只支持 PNG/JPEG 图片")
    if min(width, height) < 16:
        raise PixelPerfectInputError("图片最短边不能小于 16px")
    pixel_count = width * height
    if pixel_count > 4_000_000:
        raise PixelPerfectInputError("图片像素数不能超过 4000000")
    return width, height


def _validate_reconstruction(png: bytes, cols: int, rows: int) -> None:
    try:
        with Image.open(BytesIO(png)) as image:
            if image.format != "PNG" or image.size != (cols, rows):
                raise PixelPerfectUnavailableError(
                    "重建器返回的 PNG 尺寸与显式网格不一致"
                )
            image.load()
    except PixelPerfectUnavailableError:
        raise
    except (
        Image.DecompressionBombError,
        Image.DecompressionBombWarning,
        UnidentifiedImageError,
        OSError,
    ) as error:
        raise PixelPerfectUnavailableError("重建器返回了无效 PNG") from error
