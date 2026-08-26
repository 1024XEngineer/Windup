"""抽帧必须流式,不能把整段视频 materialize 出来(2026-08-10 机器审 P2)。

原先 ``iio.imread`` 一次性读出 ``(T, H, W, C)``。实测 121 帧 720p 的真实 i2v 视频,
进程 RSS 峰值 488 MiB,而抽 16 帧只需要其中 16 帧;并发 worker 叠加时这是实打实的内存墙。
改成 ``imiter`` 后同一段视频 126 MiB(降 74%);抽 8 帧降 79%。

如实说明降幅的边界:``extract_all_frames_bytes(cap=150)``(周期检测用)会保留全部 121 帧,
只降 42% —— 省掉的是那个完整 ndarray,保留帧本身该占的内存还在。
"""
from __future__ import annotations

import numpy as np
import pytest
from PIL import Image

from windup_ai_engine.slicing.extract import (
    _extract_frames,
    _frame_count,
    _uniform_indices,
    extract_frames_at,
    extract_frames_bytes,
    extract_preview_frames,
)


class _WentThroughImread(BaseException):
    """故意继承 BaseException 而不是 Exception —— 见下面用例的 docstring。"""


def _forbidden(*a, **k):
    raise _WentThroughImread("走了 imread:整段视频被 materialize 了")


@pytest.fixture(scope="module")
def video(tmp_path_factory) -> str:
    """20 帧的合成视频,每帧一个可辨认的灰度值,用来验"抽到的是哪几帧"。"""
    iio = pytest.importorskip("imageio.v3")
    path = tmp_path_factory.mktemp("v") / "ramp.mp4"
    # 每帧填 i*12,H.264 有损但相邻帧差 12 足以区分;尺寸取 16 的倍数避开编码器 padding。
    frames = [np.full((64, 64, 3), i * 12, dtype=np.uint8) for i in range(20)]
    iio.imwrite(path, np.stack(frames), plugin="pyav", codec="libx264")
    return str(path)


# ── 下标计算 ────────────────────────────────────────────────────────────────


@pytest.mark.parametrize(("total", "n", "expect"), [
    (20, 1, [0]),          # n=1 不能撞 /(n-1) 除零
    (1, 8, [0]),           # 要的比有的多:给全部,不重复
    (1, 1, [0]),
    (20, 20, list(range(20))),
    (20, 2, [0, 19]),      # 必须含首尾
])
def test_uniform_indices_covers_the_boundaries(total, n, expect):
    assert _uniform_indices(total, n) == expect


def test_uniform_indices_never_exceeds_total():
    for total in (1, 3, 20, 121):
        for n in (1, 5, 16, 150):
            idx = _uniform_indices(total, n)
            assert len(idx) == min(n, total)
            assert len(set(idx)) == len(idx), "下标不该重复——重复等于同一帧算两帧"
            assert idx == sorted(idx) and idx[0] == 0
            # n=1 取首帧(与改造前的实现一致,已在 14 段真实视频上验过逐像素相同);
            # 关键姿势的选择归 pick_oneshot,不由抽帧层猜。
            assert len(idx) == 1 or idx[-1] == total - 1


# ── 流式:不许再整段读入 ─────────────────────────────────────────────────────


def test_extraction_does_not_materialise_the_whole_video(video, monkeypatch):
    """把 ``imread`` 换成炸弹:仍能抽帧,才说明走的是逐帧迭代。

    这是本文件的核心断言 —— 改回 ``iio.imread`` 会让它变红(变异测试确认)。

    炸弹必须抛 ``BaseException`` 的子类:``_extract_frames`` 用 ``except Exception``
    兜底到 ffmpeg,抛 ``AssertionError`` 会被它吞掉、静默走 ffmpeg 分支产出正确帧数,
    这条用例于是变成摆设 —— 2026-08-10 变异测试逮到,原版正是这么写的。
    """
    import imageio.v3 as iio

    monkeypatch.setattr(iio, "imread", _forbidden)
    frames = _extract_frames(video, 5)
    assert len(frames) == 5
    assert all(isinstance(f, Image.Image) and f.mode == "RGBA" for f in frames)


def test_extracted_frames_are_the_uniformly_spaced_ones(video):
    """抽的是首尾与均匀分布的那几帧,不是前 n 帧。

    合成视频每帧灰度递增,所以取出来的灰度序列必须是递增且跨越全程的。
    """
    frames = _extract_frames(video, 5)
    greys = [int(np.asarray(f.convert("L")).mean()) for f in frames]
    assert greys == sorted(greys), f"帧序错乱:{greys}"
    assert greys[0] < 30, f"首帧不是第 0 帧(灰度 {greys[0]})"
    assert greys[-1] > 200, f"末帧不是最后一帧(灰度 {greys[-1]})"


def test_asking_for_more_frames_than_the_video_has_returns_all(video):
    """要 150 帧、视频只有 20 帧:给 20 帧,不静默补帧也不报错。"""
    assert len(_extract_frames(video, 150)) == 20


def test_bytes_entry_point_streams_too(video, monkeypatch):
    """公开入口是 bytes 版,它也必须走流式,且 pyav 成功时不落盘。"""
    import imageio.v3 as iio
    import windup_ai_engine.slicing.extract as extract_mod

    monkeypatch.setattr(iio, "imread", _forbidden)
    monkeypatch.setattr(extract_mod.tempfile, "TemporaryDirectory", _forbidden)
    with open(video, "rb") as f:
        assert len(extract_frames_bytes(f.read(), 4)) == 4


def test_preview_frames_are_48px_and_keep_source_indices(video):
    """Pass A 只留 48×48,下标仍指向源视频,不能先解成 720p 再缩。"""
    with open(video, "rb") as f:
        previews, src_idx = extract_preview_frames(f.read(), cap=150, size=48)
    assert src_idx == list(range(20))
    assert len(previews) == 20
    assert all(p.size == (48, 48) and p.mode == "RGB" for p in previews)


def test_extract_frames_at_returns_the_requested_ramp_frames(video):
    """Pass B 按下标取全分辨率帧,不是前 n 帧。"""
    with open(video, "rb") as f:
        frames = extract_frames_at(f.read(), [0, 10, 19])
    assert len(frames) == 3
    assert all(f.size == (64, 64) and f.mode == "RGBA" for f in frames)
    greys = [int(np.asarray(f.convert("L")).mean()) for f in frames]
    assert greys[0] < greys[1] < greys[2], greys
    assert greys[0] < 30, greys[0]
    assert greys[-1] > 200, greys[-1]


def test_preview_and_at_do_not_materialise_via_imread(video, monkeypatch):
    import imageio.v3 as iio

    monkeypatch.setattr(iio, "imread", _forbidden)
    with open(video, "rb") as f:
        data = f.read()
    previews, src_idx = extract_preview_frames(data, size=48)
    assert len(previews) == len(src_idx) == 20
    assert extract_frames_at(data, [0, 19])[0].mode == "RGBA"


def test_ffmpeg_fallback_selects_only_needed_frames(video, monkeypatch):
    """冷路径禁止把整段导出成全分辨率 PNG;只 select 要的下标。"""
    import imageio.v3 as iio
    import subprocess

    monkeypatch.setattr(iio, "improps", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("no pyav")))
    monkeypatch.setattr(iio, "imiter", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("no pyav")))

    seen: list[list[str]] = []
    real = subprocess.run

    def spy(args, **kw):
        seen.append(list(args))
        return real(args, **kw)

    monkeypatch.setattr(subprocess, "run", spy)
    frames = _extract_frames(video, 4)
    assert len(frames) == 4
    png_cmds = [c for c in seen if any(str(a).endswith(".png") for a in c)]
    assert png_cmds, seen
    assert all("-vf" in c for c in png_cmds), png_cmds
    assert any(any("select=" in str(a) for a in c) for c in png_cmds), png_cmds


def test_ffmpeg_preview_fallback_stays_small(video, monkeypatch):
    """预览冷路径可以落小 PNG,但不能解成全分辨率。"""
    import imageio.v3 as iio

    monkeypatch.setattr(iio, "improps", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("no pyav")))
    monkeypatch.setattr(iio, "imiter", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("no pyav")))
    with open(video, "rb") as f:
        previews, src_idx = extract_preview_frames(f.read(), size=48)
    assert src_idx == list(range(20))
    assert all(p.size == (48, 48) and p.mode == "RGB" for p in previews)


def test_ffmpeg_frames_at_fallback_keeps_requested_order(video, monkeypatch):
    import imageio.v3 as iio

    monkeypatch.setattr(iio, "improps", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("no pyav")))
    monkeypatch.setattr(iio, "imiter", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("no pyav")))
    with open(video, "rb") as f:
        frames = extract_frames_at(f.read(), [19, 0])
    greys = [int(np.asarray(f.convert("L")).mean()) for f in frames]
    assert greys[0] > 200 and greys[1] < 30, greys


def test_bundled_ffmpeg_is_used_when_pyav_cannot_decode(video, monkeypatch):
    import imageio.v3 as iio
    from imageio_ffmpeg import get_ffmpeg_exe

    monkeypatch.setattr(iio, "improps", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("no pyav")))
    monkeypatch.setattr(iio, "imiter", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("no pyav")))

    frames = _extract_frames(video, 4)

    assert get_ffmpeg_exe()
    assert len(frames) == 4


# ── 帧数元数据不可信时的兜底 ─────────────────────────────────────────────────


def test_frame_count_falls_back_to_counting_when_metadata_is_useless(video, monkeypatch):
    """容器元数据在 14 段真实视频上都准,但不同编码的 n_frames 并非都可靠。

    元数据给 0 / None / 抛错时必须退回逐帧计数——按错的帧数算下标会抽出错位的帧,
    那是"看起来成功"的失败(帧数对、内容错)。
    """
    import imageio.v3 as iio

    assert _frame_count(video) == 20

    class _Props:
        shape = (0, 64, 64, 3)

    monkeypatch.setattr(iio, "improps", lambda *a, **k: _Props())
    assert _frame_count(video) == 20, "元数据报 0 帧时没退回计数"

    monkeypatch.setattr(iio, "improps", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("no")))
    assert _frame_count(video) == 20, "元数据抛错时没退回计数"
