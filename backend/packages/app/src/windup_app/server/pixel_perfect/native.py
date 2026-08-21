"""PyO3 原生扩展与 Python 工具编排之间的适配层。"""

from collections.abc import Callable
from importlib import import_module
import math
from typing import Protocol

from windup_app.server.pixel_perfect.errors import (
    PixelPerfectInputError,
    PixelPerfectUnavailableError,
)
from windup_app.server.pixel_perfect.model import GridDetection


class PixelPerfectNativeModule(Protocol):
    def detect(self, source: bytes, mode: str) -> object: ...

    def reconstruct(
        self,
        source: bytes,
        cols: int,
        rows: int,
        colors: int,
    ) -> object: ...


NativeModuleLoader = Callable[[], PixelPerfectNativeModule]


def _load_installed_module() -> PixelPerfectNativeModule:
    return import_module("windup_pixel_perfect_native")


def _load_native(loader: NativeModuleLoader) -> PixelPerfectNativeModule:
    try:
        return loader()
    except (ImportError, OSError) as error:
        raise PixelPerfectUnavailableError(
            "本地像素原生扩展未安装或无法加载"
        ) from error


class NativeGridDetector:
    def __init__(
        self, module_loader: NativeModuleLoader = _load_installed_module
    ) -> None:
        self._module_loader = module_loader

    def detect(self, source: bytes) -> GridDetection:
        native = _load_native(self._module_loader)
        try:
            payload = native.detect(source, "full")
        except ValueError as error:
            raise PixelPerfectInputError(
                str(error) or "原生检测器拒绝了输入"
            ) from error
        except Exception as error:
            raise PixelPerfectUnavailableError("原生检测器调用失败") from error

        expected = {
            "cols",
            "rows",
            "step_x",
            "step_y",
            "consensus",
            "confidence",
        }
        if not isinstance(payload, dict) or set(payload) != expected:
            raise PixelPerfectUnavailableError("检测器返回字段不符合约定")
        try:
            result = GridDetection(**payload)
        except TypeError as error:
            raise PixelPerfectUnavailableError("检测器返回类型不符合约定") from error
        if (
            not isinstance(result.cols, int)
            or isinstance(result.cols, bool)
            or not isinstance(result.rows, int)
            or isinstance(result.rows, bool)
            or result.cols < 1
            or result.rows < 1
            or not isinstance(result.step_x, (int, float))
            or isinstance(result.step_x, bool)
            or not isinstance(result.step_y, (int, float))
            or isinstance(result.step_y, bool)
            or not math.isfinite(result.step_x)
            or not math.isfinite(result.step_y)
            or result.step_x <= 0
            or result.step_y <= 0
            or not isinstance(result.consensus, str)
            or result.confidence not in {"high", "medium", "low"}
        ):
            raise PixelPerfectUnavailableError("检测器返回值超出约定")
        return result


class NativeGridReconstructor:
    def __init__(
        self, module_loader: NativeModuleLoader = _load_installed_module
    ) -> None:
        self._module_loader = module_loader

    def reconstruct(self, source: bytes, *, cols: int, rows: int, colors: int) -> bytes:
        native = _load_native(self._module_loader)
        try:
            output = native.reconstruct(source, cols, rows, colors)
        except ValueError as error:
            raise PixelPerfectInputError(
                str(error) or "原生重建器拒绝了输入"
            ) from error
        except Exception as error:
            raise PixelPerfectUnavailableError("原生重建器调用失败") from error
        if not isinstance(output, bytes):
            raise PixelPerfectUnavailableError("重建器返回类型不符合约定")
        if len(output) > 32 * 1024 * 1024:
            raise PixelPerfectUnavailableError("重建器返回数据过大")
        return output
