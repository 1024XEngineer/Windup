"""循环闭合(周期检测 + 单周期取帧)测试 —— 纯 CV,无需联网。"""

from PIL import Image

from windup_ai_engine.slicing import find_period, pick_cycle


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


def test_pick_cycle_passthrough_when_too_few():
    frames = _periodic_frames(period=4, cycles=1)  # 4 帧 < 8
    assert pick_cycle(frames, 8) is frames


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
