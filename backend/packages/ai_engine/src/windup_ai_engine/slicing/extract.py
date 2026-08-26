"""视频抽帧（切片层的解码入口）。

承接视频路线（Issue #35）：i2v 产出的短视频步态真实但为插画质感。本模块只负责
把视频 bytes 解码成帧序列；选帧（周期 / 一次性）见 :mod:`.loop` / :mod:`.oneshot`，
像素化 / 对齐 / 打包见 :mod:`..postprocess`。抽帧后端（imageio/ffmpeg）函数内惰性，
模块导入零成本、CI 可收集。
"""

from __future__ import annotations

import glob
import io
import logging
import os
import re
import tempfile
from collections.abc import Sequence
from pathlib import Path

from PIL import Image

logger = logging.getLogger("windup.ai_engine.extract")

__all__ = [
    "extract_frames_bytes",
    "extract_all_frames_bytes",
    "extract_preview_frames",
    "extract_frames_at",
]

_PYAV = {"plugin": "pyav"}
_PYAV_BYTES = {"plugin": "pyav", "extension": ".mp4"}


def extract_frames_bytes(video: bytes, n: int) -> list[Image.Image]:
    """从视频 bytes 均匀抽 ``n`` 帧。优先内存解码,不落盘。"""
    return _extract_frames(video, n)


def extract_all_frames_bytes(video: bytes, cap: int = 150) -> list[Image.Image]:
    """抽视频全部帧（至多 ``cap``，均匀降采样）。测试 / 冷路径;生产走两遍解码。"""
    return _extract_frames(video, cap)


def extract_preview_frames(
    video: bytes, cap: int = 150, size: int = 48
) -> tuple[list[Image.Image], list[int]]:
    """Pass A:流式解码后立刻缩到 ``size``×``size`` RGB,丢掉全分辨率。

    返回 ``(previews, src_idx)``:预览帧与各自在源视频里的下标。均匀取样口径与
    :func:`extract_all_frames_bytes` 相同。选帧算法吃这批小图即可,不必常驻 150 张 720p。
    """
    return _extract_preview(video, cap, size)


def extract_frames_at(video: bytes, indices: Sequence[int]) -> list[Image.Image]:
    """Pass B:只把指定源下标解成全分辨率 RGBA。返回顺序与 ``indices`` 一致。"""
    return _extract_at(video, list(indices))


def _uniform_indices(total: int, n: int) -> list[int]:
    """在 ``total`` 帧里均匀取 ``min(n, total)`` 个下标(含首尾)。"""
    m = min(n, total)
    return [round(i * (total - 1) / max(1, m - 1)) for i in range(m)]


def _pyav_source(source: str | bytes) -> tuple[str | io.BytesIO, dict]:
    if isinstance(source, (bytes, bytearray)):
        return io.BytesIO(source), dict(_PYAV_BYTES)
    return source, dict(_PYAV)


def _rewind(handle: object) -> None:
    seek = getattr(handle, "seek", None)
    if seek is not None:
        seek(0)


def _frame_count(source, kw: dict | None = None) -> int:
    """帧数。先问容器元数据,不可信时退回逐帧计数(计数不保留帧,内存不涨)。

    元数据在 14 段真实 i2v 视频上与实际帧数全部一致(2026-08-10 实测),但不同容器/编码
    的 ``n_frames`` 并非都可靠,所以拿不到正整数就退回计数——多解一遍换一个确定的数,
    比按错的帧数抽出错位的帧划算。
    """
    import imageio.v3 as iio

    opts = dict(kw or _PYAV)
    try:
        shape = iio.improps(source, **opts).shape
        if shape and isinstance(shape[0], int) and shape[0] > 0:
            return shape[0]
    except Exception:
        pass
    _rewind(source)
    total = sum(1 for _ in iio.imiter(source, **opts))
    _rewind(source)
    return total


def _as_pil(frame, *, preview: bool, size: int) -> Image.Image:
    im = Image.fromarray(frame)
    if preview:
        return im.convert("RGB").resize((size, size))
    return im.convert("RGBA")


def _pyav_take(
    handle, kw: dict, indices: Sequence[int], *, preview: bool, size: int = 48
) -> dict[int, Image.Image] | None:
    """按源下标从已打开的 pyav 流取帧。缺帧返回 None,让调用方回退 ffmpeg。"""
    import imageio.v3 as iio

    wanted = set(indices)
    if not wanted:
        return {}
    found: dict[int, Image.Image] = {}
    for i, frame in enumerate(iio.imiter(handle, **kw)):
        if i in wanted:
            found[i] = _as_pil(frame, preview=preview, size=size)
            if len(found) == len(wanted):
                break
    if len(found) != len(wanted):
        return None
    return found


def _extract_preview(
    source: str | bytes, cap: int, size: int
) -> tuple[list[Image.Image], list[int]]:
    handle, kw = _pyav_source(source)
    try:
        total = _frame_count(handle, kw)
        if total <= 0:
            raise RuntimeError("视频无可解码帧")
        src_idx = _uniform_indices(total, cap)
        _rewind(handle)
        found = _pyav_take(handle, kw, src_idx, preview=True, size=size)
        if found is not None:
            return [found[i] for i in src_idx], src_idx
    except Exception:                                   # noqa: BLE001 - 兜底到 ffmpeg
        logger.warning("imageio 预览抽帧失败,回退系统 ffmpeg", exc_info=True)
    return _ffmpeg_preview(source, cap, size)


def _extract_at(source: str | bytes, indices: list[int]) -> list[Image.Image]:
    if not indices:
        return []
    handle, kw = _pyav_source(source)
    try:
        found = _pyav_take(handle, kw, indices, preview=False)
        if found is not None:
            return [found[i] for i in indices]
    except Exception:                                   # noqa: BLE001 - 兜底到 ffmpeg
        logger.warning("imageio 定点抽帧失败,回退系统 ffmpeg", exc_info=True)
    return _ffmpeg_at(source, indices)


def _extract_frames(source: str | bytes, n: int) -> list[Image.Image]:
    """从视频均匀抽 ``n`` 帧。优先 imageio(流式),回退系统 ffmpeg。

    **流式而不是一次性读整段**(2026-08-10,机器审 P2):原先走 ``iio.imread`` 会把
    ``(T, H, W, C)`` 整个 materialize 出来。实测 121 帧 720p 的真实 i2v 视频峰值
    319 MiB,而我们只要其中 8~16 帧;并发 worker 叠加时这是实打实的内存墙。
    现在峰值≈保留帧数 × 单帧,与视频长度无关。

    bytes 入口走内存缓冲,避免把 mp4 写到 overlay/云盘再读回来。
    """
    handle, kw = _pyav_source(source)
    try:
        total = _frame_count(handle, kw)
        if total <= 0:
            raise RuntimeError("视频无可解码帧")
        idx = _uniform_indices(total, n)
        _rewind(handle)
        found = _pyav_take(handle, kw, idx, preview=False)
        if found is not None:
            return [found[i] for i in idx]
    except Exception:                                   # noqa: BLE001 - 兜底到 ffmpeg
        # 不静默:这个 except 曾把"我们自己算错下标"和"环境里没装 imageio"混为一谈,
        # 两者都表现为悄悄换用 ffmpeg 分支、产出看着正常的帧。至少留一条日志。
        logger.warning("imageio 抽帧失败,回退系统 ffmpeg", exc_info=True)

    return _ffmpeg_extract(source, n)


def _video_path(source: str | bytes, tmp: str) -> str:
    if isinstance(source, str):
        return source
    path = str(Path(tmp) / "source.mp4")
    Path(path).write_bytes(source)
    return path


def _ffmpeg_exe() -> str:
    from imageio_ffmpeg import get_ffmpeg_exe

    return get_ffmpeg_exe()


def _ffmpeg_run(args: list[str]) -> None:
    import subprocess

    subprocess.run(args, capture_output=True, check=True)


def _ffmpeg_count(video_path: str) -> int:
    """解码计数,不落 PNG。比把整段导出成全分辨率 PNG 再 len(files) 便宜。"""
    import subprocess

    proc = subprocess.run(
        [_ffmpeg_exe(), "-i", video_path, "-vsync", "0", "-f", "null", "-"],
        capture_output=True,
    )
    text = (proc.stderr or b"").decode("utf-8", errors="replace")
    hits = re.findall(r"frame=\s*(\d+)", text)
    if not hits or int(hits[-1]) <= 0:
        raise RuntimeError("抽帧失败:视频无可解码帧")
    return int(hits[-1])


def _select_filter(indices: Sequence[int]) -> str:
    """只留下这些源下标。逗号按 ffmpeg filtergraph 规则转义。"""
    uniq = sorted(set(indices))
    select = "+".join(f"eq(n\\,{i})" for i in uniq)
    return f"select={select},setpts=N/TB"


def _load_pngs(files: list[str]) -> list[Image.Image]:
    return [Image.open(p).convert("RGBA").copy() for p in files]


def _ffmpeg_at_path(video_path: str, tmp: str, indices: list[int]) -> list[Image.Image]:
    uniq = sorted(set(indices))
    if not uniq:
        return []
    pattern = os.path.join(tmp, "f_%04d.png")
    _ffmpeg_run(
        [_ffmpeg_exe(), "-y", "-i", video_path, "-vf", _select_filter(uniq),
         "-vsync", "vfr", pattern],
    )
    files = sorted(glob.glob(os.path.join(tmp, "f_*.png")))
    if len(files) != len(uniq):
        raise RuntimeError(
            f"抽帧失败:要 {len(uniq)} 帧,ffmpeg 交出 {len(files)} 帧"
        )
    by_n = {n: im for n, im in zip(uniq, _load_pngs(files))}
    return [by_n[i] for i in indices]


def _ffmpeg_at(source: str | bytes, indices: list[int]) -> list[Image.Image]:
    with tempfile.TemporaryDirectory() as tmp:
        return _ffmpeg_at_path(_video_path(source, tmp), tmp, indices)


def _ffmpeg_preview(
    source: str | bytes, cap: int, size: int
) -> tuple[list[Image.Image], list[int]]:
    """冷路径:整段缩到小图再均匀取。小 PNG 常驻可接受,禁止落全分辨率。"""
    with tempfile.TemporaryDirectory() as tmp:
        video_path = _video_path(source, tmp)
        pattern = os.path.join(tmp, "f_%04d.png")
        _ffmpeg_run(
            [_ffmpeg_exe(), "-y", "-i", video_path,
             "-vf", f"scale={size}:{size}", "-vsync", "0", pattern],
        )
        files = sorted(glob.glob(os.path.join(tmp, "f_*.png")))
        if not files:
            raise RuntimeError("抽帧失败:视频无可解码帧")
        src_idx = _uniform_indices(len(files), cap)
        previews = [Image.open(files[i]).convert("RGB").copy() for i in src_idx]
        return previews, src_idx


def _ffmpeg_extract(source: str | bytes, n: int) -> list[Image.Image]:
    """仅 pyav 失败时走。按均匀下标 ``select``,不把整段导出成全分辨率 PNG。"""
    with tempfile.TemporaryDirectory() as tmp:
        video_path = _video_path(source, tmp)
        total = _ffmpeg_count(video_path)
        idx = _uniform_indices(total, n)
        return _ffmpeg_at_path(video_path, tmp, idx)
