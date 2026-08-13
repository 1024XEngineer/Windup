"""视频抽帧（切片层的解码入口）。

承接视频路线（Issue #35）：i2v 产出的短视频步态真实但为插画质感。本模块只负责
把视频 bytes 解码成帧序列；选帧（周期 / 一次性）见 :mod:`.loop` / :mod:`.oneshot`，
像素化 / 对齐 / 打包见 :mod:`..postprocess`。抽帧后端（imageio/ffmpeg）函数内惰性，
模块导入零成本、CI 可收集。
"""

from __future__ import annotations

import logging
import os
import tempfile
from pathlib import Path

from PIL import Image

logger = logging.getLogger("windup.ai_engine.extract")

__all__ = ["extract_frames_bytes", "extract_all_frames_bytes"]


def extract_frames_bytes(video: bytes, n: int) -> list[Image.Image]:
    """从视频 bytes 均匀抽 ``n`` 帧（供后端 strategy 用，provider 返回的是 bytes）。"""
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "source.mp4"
        path.write_bytes(video)
        return _extract_frames(str(path), n)


def extract_all_frames_bytes(video: bytes, cap: int = 150) -> list[Image.Image]:
    """抽视频全部帧（至多 ``cap``，均匀降采样），供周期检测用。"""
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "source.mp4"
        path.write_bytes(video)
        return _extract_frames(str(path), cap)


def _uniform_indices(total: int, n: int) -> list[int]:
    """在 ``total`` 帧里均匀取 ``min(n, total)`` 个下标(含首尾)。"""
    m = min(n, total)
    return [round(i * (total - 1) / max(1, m - 1)) for i in range(m)]


def _frame_count(video_path: str) -> int:
    """帧数。先问容器元数据,不可信时退回逐帧计数(计数不保留帧,内存不涨)。

    元数据在 14 段真实 i2v 视频上与实际帧数全部一致(2026-08-10 实测),但不同容器/编码
    的 ``n_frames`` 并非都可靠,所以拿不到正整数就退回计数——多解一遍换一个确定的数,
    比按错的帧数抽出错位的帧划算。
    """
    import imageio.v3 as iio

    try:
        shape = iio.improps(video_path, plugin="pyav").shape
        if shape and isinstance(shape[0], int) and shape[0] > 0:
            return shape[0]
    except Exception:
        pass
    return sum(1 for _ in iio.imiter(video_path, plugin="pyav"))


def _extract_frames(video_path: str, n: int) -> list[Image.Image]:
    """从视频均匀抽 ``n`` 帧。优先 imageio(流式),回退系统 ffmpeg。

    **流式而不是一次性读整段**(2026-08-10,机器审 P2):原先走 ``iio.imread`` 会把
    ``(T, H, W, C)`` 整个 materialize 出来。实测 121 帧 720p 的真实 i2v 视频峰值
    319 MiB,而我们只要其中 8~16 帧;并发 worker 叠加时这是实打实的内存墙。
    现在峰值≈保留帧数 × 单帧,与视频长度无关。
    """
    try:
        import imageio.v3 as iio

        total = _frame_count(video_path)
        if total <= 0:
            raise RuntimeError("视频无可解码帧")
        wanted = set(_uniform_indices(total, n))
        out: list[Image.Image] = []
        for i, frame in enumerate(iio.imiter(video_path, plugin="pyav")):
            if i in wanted:
                # convert 之后原始 ndarray 就可以被回收;不持有 frame 本身。
                out.append(Image.fromarray(frame).convert("RGBA"))
                if len(out) == len(wanted):
                    break
        if out:
            return out
    except Exception:                                   # noqa: BLE001 - 兜底到 ffmpeg
        # 不静默:这个 except 曾把"我们自己算错下标"和"环境里没装 imageio"混为一谈,
        # 两者都表现为悄悄换用 ffmpeg 分支、产出看着正常的帧。至少留一条日志。
        logger.warning("imageio 抽帧失败,回退系统 ffmpeg", exc_info=True)

    import glob
    import subprocess
    from imageio_ffmpeg import get_ffmpeg_exe

    with tempfile.TemporaryDirectory() as tmp:
        subprocess.run(
            [get_ffmpeg_exe(), "-y", "-i", video_path, "-vsync", "0",
             os.path.join(tmp, "f_%04d.png")],
            capture_output=True, check=True,
        )
        files = sorted(glob.glob(os.path.join(tmp, "f_*.png")))
        if not files:
            raise RuntimeError("抽帧失败:视频无可解码帧")
        m = min(n, len(files))
        idx = [round(i * (len(files) - 1) / max(1, m - 1)) for i in range(m)]
        return [Image.open(files[i]).convert("RGBA").copy() for i in idx]
