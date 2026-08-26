"""一次性动作抽帧(裁动作区间 / 跳跃状态切段)测试 —— 纯 CV,无需联网。"""

import numpy as np
import pytest
from PIL import Image

from windup_ai_engine.slicing import (
    find_motion_span,
    first_action_end,
    foot_line_series,
    pick_oneshot,
    pick_oneshot_indices,
    split_jump_phases,
)
from windup_ai_engine.slicing._frames import SMALL


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


# ── 入参边界 ────────────────────────────────────────────────────────────────
# 契约:返回长度恒等于 n;凡是给不出 n 帧的入参一律报错,绝不静默少给。


def _bar_at(x: int, w: int = 8, size: int = 64) -> Image.Image:
    """横向位移的方块,用来造挥击序列。位移刻意都 < 条宽 → 像素差与位移成正比、不饱和。"""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    arr = np.asarray(img).copy()
    arr[20:50, x : x + w] = (200, 60, 60, 255)
    return Image.fromarray(arr, "RGBA")


def _swing_sequence() -> list[Image.Image]:
    """合成挥击:静止 → 加速横扫(最快的一跳是 16→22)→ 收势 → 静止。"""
    xs = [10] * 4 + [11, 13, 16, 22, 25, 26] + [26] * 4
    return [_bar_at(x) for x in xs]


def _tail_action_sequence() -> list[Image.Image]:
    """动作贴在尾部(视频在半空结束,没有静止收尾)—— 区间放宽时右边无处可长,
    必须把缺口退回左边,否则窗口不足 n 帧、只能靠重复帧凑数。"""
    ys = [50] * 8 + [52, 52, 44, 38, 30, 30, 38, 44]
    return [_figure_at(y) for y in ys]


def test_pick_oneshot_n1_takes_apex_for_airborne():
    """n=1 取关键姿势:腾空类应给顶点帧,而不是首帧(蓄力,和待机一个样)。"""
    frames = _jump_sequence()
    apex = int(np.argmin(foot_line_series(frames)))
    out = pick_oneshot(frames, 1, kind="airborne")
    assert len(out) == 1
    assert out[0] is frames[apex]


def test_pick_oneshot_n1_takes_impact_for_swing():
    """n=1 取关键姿势:挥击类应给"刚走完最快一跳"的命中帧,不是首帧/末帧。"""
    frames = _swing_sequence()
    out = pick_oneshot(frames, 1)
    assert len(out) == 1
    assert out[0] is frames[7]                      # 16→22 是最快的一跳,落点即命中姿势
    assert out[0] is not frames[0] and out[0] is not frames[-1]


def test_pick_oneshot_rejects_non_positive_n():
    """n<=0 原本静默返回 [](零帧也算"成功"),现在必须报错。"""
    frames = _jump_sequence()
    for n in (0, -1):
        with pytest.raises(ValueError, match="n 必须"):
            pick_oneshot(frames, n)


def test_pick_oneshot_rejects_insufficient_source():
    """源帧不够 n 帧:报错并把两个数字都说清楚,不再原样返回一个短序列。"""
    frames = _jump_sequence()
    with pytest.raises(ValueError, match=r"源帧不足.*19.*14"):
        pick_oneshot(frames, len(frames) + 5)
    with pytest.raises(ValueError, match="源帧不足"):
        pick_oneshot([], 4)
    with pytest.raises(ValueError, match="源帧不足"):
        pick_oneshot([_figure_at(50)], 2)


def test_pick_oneshot_returns_exactly_n_for_every_legal_n():
    """全量扫 n=1..len(frames):长度必须恒等于 n。

    修前 pick_oneshot(jump14, 12) 只回 9 帧 —— 动作区间被裁到 9 帧后直接原样返回,
    而下游 frame_durations 按实际长度现算时长,帧数与时长自洽,谁都看不出少了 3 帧。
    """
    for frames in (_jump_sequence(), _swing_sequence(), _tail_action_sequence()):
        for kind in ("swing", "airborne"):
            for n in range(1, len(frames) + 1):
                assert len(pick_oneshot(frames, n, kind=kind)) == n, (kind, n)
        for n in range(1, len(frames) + 1):        # first_only=False 走另一条区间分支
            assert len(pick_oneshot(frames, n, first_only=False)) == n


def test_pick_oneshot_passthrough_when_n_equals_len():
    frames = _jump_sequence()
    assert pick_oneshot(frames, len(frames)) is frames


def test_pick_oneshot_indices_match_pick_oneshot_identities():
    frames = _jump_sequence()
    for n in (1, 6, len(frames)):
        out = pick_oneshot(frames, n, kind="airborne")
        idx = pick_oneshot_indices(frames, n, kind="airborne")
        assert len(idx) == n
        assert all(out[j] is frames[i] for j, i in enumerate(idx))


def test_pick_oneshot_frames_are_distinct_source_frames_in_order():
    """源帧够 n 张时,返回的 n 帧必须**互不相同**且时间顺序不倒。

    长度对但夹着重复帧,是另一种"看起来成功"的错结果:时长表照样自洽,播出来是卡顿。
    动作贴尾部的序列是这条的关键用例 —— 区间往右长不动,缺口只能退回左边补。
    """
    for frames in (_jump_sequence(), _swing_sequence(), _tail_action_sequence()):
        for n in range(1, len(frames) + 1):
            out = pick_oneshot(frames, n, kind="airborne")
            pos = [next(i for i, f in enumerate(frames) if f is o) for o in out]
            assert pos == sorted(pos), (n, pos)
            assert len(set(pos)) == n, (n, pos)         # 无重复帧


def _long_descent_jump(size: int) -> list[Image.Image]:
    """长下降 + 落地后再起跳:固定 6px 容差在小图上会提前截断,按画高缩放则不应。"""
    ground = round(size * 0.78)
    apex = round(size * 0.22)
    crouch = min(size - 1, ground + max(1, size // 32))
    fig_h = max(6, size // 5)
    n_fall = 12
    fall = [round(apex + (ground - apex) * i / n_fall) for i in range(1, n_fall)]
    ys = (
        [ground] * 4
        + [crouch, crouch]
        + [round(apex + (ground - apex) * 0.35), round(apex + (ground - apex) * 0.12), apex, apex]
        + fall
        + [ground] * 3
        + [crouch, round((apex + ground) / 2), apex]
    )
    return [_figure_at(y, size=size, h=fig_h) for y in ys]


def test_airborne_pick_indices_match_fullres_and_48_preview():
    """生产路径 Pass A 是 48×48;jump 下标必须与全分辨率选帧一致,不能提前截下降段。"""
    src = _long_descent_jump(192)
    preview = [f.resize((SMALL, SMALL), Image.NEAREST) for f in src]
    assert first_action_end(src, *find_motion_span(src), kind="airborne") == first_action_end(
        preview, *find_motion_span(preview), kind="airborne"
    )
    for n in (6, 8, 12):
        assert pick_oneshot_indices(src, n, kind="airborne") == pick_oneshot_indices(
            preview, n, kind="airborne"
        )


def test_unknown_kind_is_rejected():
    """kind 拼错不能静默按 swing 处理 —— 判据用错会裁出"看起来对"的错区间。"""
    frames = _jump_sequence()
    with pytest.raises(ValueError, match="kind"):
        pick_oneshot(frames, 6, kind="airbourne")
    with pytest.raises(ValueError, match="kind"):
        # first_only=False 不走 first_action_end,得靠 pick_oneshot 自己那道校验
        pick_oneshot(frames, 6, kind="airbourne", first_only=False)
    with pytest.raises(ValueError, match="kind"):
        first_action_end(frames, 0, 1, kind="airbourne")   # 短区间(早返回)也要拦住
