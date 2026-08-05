"""视频抽帧（切片层的解码入口）。

承接视频路线（Issue #35）：i2v 产出的短视频步态真实但为插画质感。本模块只负责
把视频 bytes 解码成帧序列；选帧（周期 / 一次性）见 :mod:`.loop` / :mod:`.oneshot`，
像素化 / 对齐 / 打包见 :mod:`..postprocess`。抽帧后端（imageio/ffmpeg）函数内惰性，
模块导入零成本、CI 可收集。
"""

from __future__ import annotations

import logging
import os
import shutil
import tempfile
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeout

from PIL import Image

logger = logging.getLogger("windup.slicing.extract")

_EXTRACT_TIMEOUT_SECONDS = 180  # 单次抽帧方案超时：3 分钟

__all__ = ["extract_frames_bytes", "extract_all_frames_bytes"]


def extract_frames_bytes(video: bytes, n: int) -> list[Image.Image]:
    """从视频 bytes 均匀抽 ``n`` 帧（供后端 strategy 用，provider 返回的是 bytes）。"""
    path = tempfile.mktemp(suffix=".mp4")
    try:
        with open(path, "wb") as f:
            f.write(video)
        return _extract_frames(path, n)
    finally:
        try:
            os.unlink(path)
        except OSError:
            pass


def extract_all_frames_bytes(video: bytes, cap: int = 150) -> list[Image.Image]:
    """抽视频全部帧（至多 ``cap``，均匀降采样），供周期检测用。"""
    path = tempfile.mktemp(suffix=".mp4")
    try:
        with open(path, "wb") as f:
            f.write(video)
        return _extract_frames(path, cap)
    finally:
        try:
            os.unlink(path)
        except OSError:
            pass


def _run_with_timeout(fn, *args, timeout: int = _EXTRACT_TIMEOUT_SECONDS):
    """在独立线程中执行 *fn*，超时则抛 TimeoutError。

    用 ThreadPoolExecutor 而非 signal，兼容 Windows 子线程场景。
    """
    with ThreadPoolExecutor(max_workers=1) as pool:
        future = pool.submit(fn, *args)
        try:
            return future.result(timeout=timeout)
        except FutureTimeout as exc:
            future.cancel()
            raise TimeoutError(
                f"抽帧耗时超过 {timeout} 秒，已终止"
            ) from exc


def _imageio_extract(video_path: str, n: int) -> list[Image.Image]:
    import imageio.v3 as iio

    all_frames = iio.imread(video_path, plugin="pyav")  # (T, H, W, C)
    total = len(all_frames)
    m = min(n, total)
    idx = [round(i * (total - 1) / max(1, m - 1)) for i in range(m)]
    return [Image.fromarray(all_frames[i]).convert("RGBA") for i in idx]


def _pyav_extract(video_path: str, n: int) -> list[Image.Image]:
    import av as _av

    container = _av.open(video_path)
    all_frames = []
    for frame in container.decode(video=0):
        all_frames.append(frame.to_rgb().to_ndarray())
    container.close()
    if not all_frames:
        return []
    total = len(all_frames)
    m = min(n, total)
    idx = [round(i * (total - 1) / max(1, m - 1)) for i in range(m)]
    return [Image.fromarray(all_frames[i]).convert("RGBA") for i in idx]


def _ffmpeg_extract(video_path: str, n: int) -> list[Image.Image]:
    import glob
    import subprocess

    with tempfile.TemporaryDirectory() as tmp:
        subprocess.run(
            ["ffmpeg", "-y", "-i", video_path, "-vsync", "0",
             os.path.join(tmp, "f_%04d.png")],
            capture_output=True, check=True,
        )
        files = sorted(glob.glob(os.path.join(tmp, "f_*.png")))
        if not files:
            raise RuntimeError("抽帧失败:视频无可解码帧")
        m = min(n, len(files))
        idx = [round(i * (len(files) - 1) / max(1, m - 1)) for i in range(m)]
        return [Image.open(files[i]).convert("RGBA").copy() for i in idx]


def _extract_frames(video_path: str, n: int) -> list[Image.Image]:
    """从视频均匀抽 ``n`` 帧。优先 imageio，回退 pyav 直调，再回退系统 ffmpeg。

    每个方案都有 3 分钟超时保护，避免解码卡死导致后台线程永久挂起。
    """
    errors: list[str] = []
    timeout = _EXTRACT_TIMEOUT_SECONDS

    # 1) imageio + pyav 插件
    try:
        return _run_with_timeout(_imageio_extract, video_path, n, timeout=timeout)
    except TimeoutError as exc:
        logger.warning("imageio 抽帧超时: %s", exc)
        errors.append(f"imageio: {exc}")
    except Exception as exc:
        logger.debug("imageio 抽帧失败，尝试下一方案: %s", exc)
        errors.append(f"imageio: {exc}")

    # 2) pyav 直调(绕过 imageio 插件初始化问题)
    try:
        return _run_with_timeout(_pyav_extract, video_path, n, timeout=timeout)
    except TimeoutError as exc:
        logger.warning("pyav 抽帧超时: %s", exc)
        errors.append(f"pyav: {exc}")
    except Exception as exc:
        logger.debug("pyav 抽帧失败，尝试下一方案: %s", exc)
        errors.append(f"pyav: {exc}")

    # 3) 系统 ffmpeg
    if shutil.which("ffmpeg") is None:
        errors.append("ffmpeg: 系统未安装 ffmpeg 或不在 PATH 中")
        raise RuntimeError(
            "视频抽帧失败，所有方案均不可用:\n"
            + "\n".join(f"  - {e}" for e in errors)
        )

    import subprocess

    try:
        return _run_with_timeout(_ffmpeg_extract, video_path, n, timeout=timeout)
    except TimeoutError as exc:
        logger.warning("ffmpeg 抽帧超时: %s", exc)
        raise RuntimeError(
            "视频抽帧失败，所有方案均超时或不可用:\n"
            + "\n".join(f"  - {e}" for e in errors)
        ) from exc
    except subprocess.CalledProcessError as exc:
        stderr = exc.stderr.decode(errors="replace") if exc.stderr else ""
        raise RuntimeError(f"ffmpeg 抽帧失败 (exit {exc.returncode}): {stderr}") from exc
