"""两个独立原生模块的进程适配器。"""

from collections.abc import Sequence
import json
import math
import subprocess
from threading import Thread

from windup_app.server.pixel_perfect.errors import (
    PixelPerfectInputError,
    PixelPerfectUnavailableError,
)
from windup_app.server.pixel_perfect.model import GridDetection


class NativeGridDetector:
    def __init__(self, command: Sequence[str], *, timeout_seconds: float) -> None:
        self._command = tuple(command)
        self._timeout_seconds = timeout_seconds

    def detect(self, source: bytes) -> GridDetection:
        output = _run(
            (*self._command, "--full"),
            source,
            timeout_seconds=self._timeout_seconds,
            stdout_limit=64 * 1024,
        )
        if len(output) > 64 * 1024:
            raise PixelPerfectUnavailableError("检测器返回数据过大")
        try:
            payload = json.loads(output)
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise PixelPerfectUnavailableError("检测器返回了无效 JSON") from error
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
    def __init__(self, command: Sequence[str], *, timeout_seconds: float) -> None:
        self._command = tuple(command)
        self._timeout_seconds = timeout_seconds

    def reconstruct(self, source: bytes, *, cols: int, rows: int, colors: int) -> bytes:
        output = _run(
            (
                *self._command,
                "--cols",
                str(cols),
                "--rows",
                str(rows),
                "--colors",
                str(colors),
            ),
            source,
            timeout_seconds=self._timeout_seconds,
            stdout_limit=32 * 1024 * 1024,
        )
        if len(output) > 32 * 1024 * 1024:
            raise PixelPerfectUnavailableError("重建器返回数据过大")
        return output


def _run(
    command: Sequence[str],
    source: bytes,
    *,
    timeout_seconds: float,
    stdout_limit: int,
    stderr_limit: int = 64 * 1024,
) -> bytes:
    if not command or timeout_seconds <= 0 or min(stdout_limit, stderr_limit) < 1:
        raise ValueError("native command and positive timeout are required")
    try:
        process = subprocess.Popen(
            command,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
    except (FileNotFoundError, OSError) as error:
        raise PixelPerfectUnavailableError("本地像素工具未安装或无法启动") from error

    stdout = bytearray()
    stderr = bytearray()
    overflow = []

    def read_bounded(stream, target: bytearray, limit: int, name: str) -> None:
        while chunk := stream.read(64 * 1024):
            remaining = limit + 1 - len(target)
            target.extend(chunk[:remaining])
            if len(target) > limit:
                overflow.append(name)
                process.kill()
                break
        stream.close()

    def write_input() -> None:
        try:
            process.stdin.write(source)
        except (BrokenPipeError, OSError):
            pass
        finally:
            process.stdin.close()

    threads = [
        Thread(target=write_input, daemon=True),
        Thread(
            target=read_bounded,
            args=(process.stdout, stdout, stdout_limit, "stdout"),
            daemon=True,
        ),
        Thread(
            target=read_bounded,
            args=(process.stderr, stderr, stderr_limit, "stderr"),
            daemon=True,
        ),
    ]
    for thread in threads:
        thread.start()
    try:
        process.wait(timeout=timeout_seconds)
    except subprocess.TimeoutExpired as error:
        process.kill()
        process.wait()
        raise PixelPerfectUnavailableError("本地像素工具处理超时") from error
    finally:
        for thread in threads:
            thread.join()

    if overflow:
        raise PixelPerfectUnavailableError(f"本地像素工具 {overflow[0]} 超过资源上限")
    if process.returncode < 0:
        raise PixelPerfectUnavailableError(
            f"本地像素工具被信号 {-process.returncode} 终止"
        )
    if process.returncode == 1:
        detail = stderr.decode("utf-8", errors="replace").strip()[:500]
        raise PixelPerfectInputError(detail or "本地像素工具拒绝了输入")
    if process.returncode != 0:
        raise PixelPerfectUnavailableError(
            f"本地像素工具异常退出（code={process.returncode}）"
        )
    return bytes(stdout)
