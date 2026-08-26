"""循环闭合(周期检测 + 单周期取帧)测试 —— 纯 CV,无需联网。"""

import pytest
from PIL import Image

from windup_ai_engine.slicing import find_period, pick_cycle, pick_cycle_indices


def _periodic_frames(period: int, cycles: int) -> list[Image.Image]:
    """构造已知周期的帧序列:亮度按周期正弦变化(每帧一张纯灰图)。"""
    import math

    frames = []
    for i in range(period * cycles):
        v = int(128 + 100 * math.sin(2 * math.pi * i / period))
        frames.append(Image.new("RGB", (48, 48), (v, v, v)))
    return frames


def test_find_period_detects_known_period():
    frames = _periodic_frames(period=20, cycles=5)
    p = find_period(frames)
    assert abs(p - 20) <= 1          # 检出周期 ≈ 真值


def test_pick_cycle_returns_n_frames():
    frames = _periodic_frames(period=20, cycles=5)
    out = pick_cycle(frames, 8)
    assert len(out) == 8


def _ramp_frames(n: int = 40) -> list[Image.Image]:
    """亮度单调上升 = 无周期,专走"测不到周期"那条分支。"""
    return [Image.new("RGB", (48, 48), (i * 4,) * 3) for i in range(n)]


def test_pick_cycle_rejects_insufficient_source():
    """源帧不够就报错(原本原样返回 4 帧,冒充"抽到了 8 帧的循环")。"""
    frames = _periodic_frames(period=4, cycles=1)  # 4 帧 < 8
    with pytest.raises(ValueError, match=r"源帧不足.*8.*4"):
        pick_cycle(frames, 8)
    with pytest.raises(ValueError, match="源帧不足"):   # 只差一帧也不放过(挡 off-by-one)
        pick_cycle(frames, len(frames) + 1)


def test_pick_cycle_passthrough_when_n_equals_len():
    frames = _periodic_frames(period=4, cycles=2)  # 8 帧 == 8
    assert pick_cycle(frames, 8) is frames


def test_pick_cycle_rejects_non_positive_n():
    """n<=0 两条分支的旧行为都不可接受:检出周期时 IndexError,测不到周期时静默返回 []。"""
    for frames in (_periodic_frames(period=20, cycles=5), _ramp_frames()):
        for n in (0, -1):
            with pytest.raises(ValueError, match="n 必须"):
                pick_cycle(frames, n)


def test_pick_cycle_n1_takes_dominant_pose():
    """n=1 的"循环"只是一张静止姿势:取全片最具代表性的一帧(停留最久的相位),
    而不是首帧 —— i2v 首帧是母版静立姿,单看读不出这是什么动作。"""
    a = Image.new("RGB", (48, 48), (200, 200, 200))
    b = Image.new("RGB", (48, 48), (40, 40, 40))
    frames = [b] + [a] * 20 + [b] * 8 + [a] * 11     # a 占多数,首帧刻意放 b
    out = pick_cycle(frames, 1)
    assert len(out) == 1
    assert out[0] is a
    assert out[0] is not frames[0]


def test_pick_cycle_returns_exactly_n_distinct_frames_for_every_legal_n():
    """全量扫 n=1..len(frames):两条分支(检出周期 / 测不到周期)都要恒好 n 帧,且互不重复。

    长度对但夹着重复帧同样是"看起来成功"的错结果 —— 取样相位塌在一起,循环里会卡一下。
    """
    for frames in (_periodic_frames(period=8, cycles=5), _ramp_frames()):
        for n in range(1, len(frames) + 1):
            out = pick_cycle(frames, n)
            assert len(out) == n, n
            pos = [next(i for i, f in enumerate(frames) if f is o) for o in out]
            assert len(set(pos)) == n, (n, pos)


def test_pick_cycle_indices_match_pick_cycle_identities():
    """下标 API 与旧的帧列表 API 指向同一组源帧对象。"""
    for frames in (_periodic_frames(period=8, cycles=5), _ramp_frames()):
        for n in (1, 8, len(frames)):
            out = pick_cycle(frames, n)
            idx = pick_cycle_indices(frames, n)
            assert len(idx) == n
            assert all(out[j] is frames[i] for j, i in enumerate(idx))


def test_pick_cycle_closes_the_loop():
    # 取出的一周期,末帧的下一拍应接近首帧(亮度差小)
    import numpy as np

    frames = _periodic_frames(period=20, cycles=5)
    out = pick_cycle(frames, 8)
    first = np.asarray(out[0].convert("L"), float)
    last = np.asarray(out[-1].convert("L"), float)
    step = np.abs(np.asarray(out[1].convert("L"), float) - first).mean()
    seam = np.abs(last - first).mean()
    assert seam <= step * 2 + 5      # 回接缝不显著大于一个正常步幅
