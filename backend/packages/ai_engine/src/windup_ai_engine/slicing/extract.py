"""视频抽帧（切片层的解码入口）。

承接视频路线（Issue #35）：i2v 产出的短视频步态真实但为插画质感。本模块只负责
把视频 bytes 解码成帧序列；选帧（周期 / 一次性）见 :mod:`.loop` / :mod:`.oneshot`，
像素化 / 对齐 / 打包见 :mod:`..postprocess`。抽帧后端（imageio/ffmpeg）函数内惰性，
模块导入零成本、CI 可收集。
"""

from __future__ import annotations

import os
import tempfile

from PIL import Image

__all__ = ["extract_frames_bytes", "extract_all_frames_bytes"]


def extract_frames_bytes(video: bytes, n: int) -> list[Image.Image]:
    """从视频 bytes 均匀抽 ``n`` 帧（供后端 strategy 用，provider 返回的是 bytes）。"""
    with tempfile.NamedTemporaryFile(suffix=".mp4", delete=True) as f:
        f.write(video)
        f.flush()
        return _extract_frames(f.name, n)


def extract_all_frames_bytes(video: bytes, cap: int = 150) -> list[Image.Image]:
    """抽视频全部帧（至多 ``cap``，均匀降采样），供周期检测用。"""
    with tempfile.NamedTemporaryFile(suffix=".mp4", delete=True) as f:
        f.write(video)
        f.flush()
        return _extract_frames(f.name, cap)


def _extract_frames(video_path: str, n: int) -> list[Image.Image]:
    """从视频均匀抽 ``n`` 帧。优先 imageio，回退系统 ffmpeg。"""
    try:
        import imageio.v3 as iio

        all_frames = iio.imread(video_path, plugin="pyav")  # (T, H, W, C)
        total = len(all_frames)
        m = min(n, total)
        idx = [round(i * (total - 1) / max(1, m - 1)) for i in range(m)]
        return [Image.fromarray(all_frames[i]).convert("RGBA") for i in idx]
    except Exception:
        pass

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
