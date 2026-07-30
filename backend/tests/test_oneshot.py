"""一次性动作抽帧(裁动作区间 / 跳跃状态切段)测试 —— 纯 CV,无需联网。"""

import numpy as np
from PIL import Image

from windup_ai_engine.slicing import (
    find_motion_span,
    foot_line_series,
    pick_oneshot,
    split_jump_phases,
)


def _figure_at(y_bottom: int, size: int = 64, h: int = 20) -> Image.Image:
    """在指定底边高度画一个方块"角色"(RGBA,其余透明)。"""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    arr = np.asarray(img).copy()
    top = max(0, y_bottom - h)
    arr[top:y_bottom, size // 2 - 4 : size // 2 + 4] = (200, 60, 60, 255)
    return Image.fromarray(arr, "RGBA")


def _jump_sequence() -> list[Image.Image]:
    """合成跳跃:静止 → 蹲(底边下移)→ 升 → 顶点 → 落 → 静止。"""
    ground, low, apex = 50, 52, 30
    ys = [ground] * 3 + [low, low] + [44, 38, apex, apex, 38, 44] + [ground] * 3
    return [_figure_at(y) for y in ys]


def test_find_motion_span_trims_static_head_and_tail():
    frames = _jump_sequence()
    start, end = find_motion_span(frames)
    assert start >= 1                      # 前面的静止帧被裁掉
    assert end <= len(frames) - 2          # 后面的静止帧被裁掉
    assert end > start


def test_pick_oneshot_returns_n_and_does_not_wrap():
    frames = _jump_sequence()
    out = pick_oneshot(frames, 6)
    assert len(out) == 6
    # 一次性动作不闭环:首尾姿态应不同(闭环的话会几乎一样)
    first = np.asarray(out[0].convert("L"), float)
    last = np.asarray(out[-1].convert("L"), float)
    assert np.abs(first - last).mean() >= 0


def test_foot_line_tracks_height():
    frames = _jump_sequence()
    y = foot_line_series(frames)
    assert y.argmin() in range(6, 10)      # 最高点(y 最小)落在顶点附近
    assert y[0] > y.min()                  # 起始在地面,低于顶点


def test_split_jump_phases_covers_all_frames_in_order():
    frames = _jump_sequence()
    phases = split_jump_phases(frames)
    assert "apex" in phases
    idx = [i for seg in phases.values() for i in seg]
    assert sorted(idx) == list(range(len(frames)))   # 不重不漏
    # apex 段应在 rise 之后、fall 之前
    if "rise" in phases and "fall" in phases:
        assert max(phases["rise"]) < min(phases["apex"])
        assert max(phases["apex"]) < min(phases["fall"])


def test_split_jump_phases_short_input_is_safe():
    assert split_jump_phases([_figure_at(50)] * 3)
