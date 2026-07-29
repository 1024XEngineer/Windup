"""循环闭合(最后一公里之一,Issue #21)—— 从 i2v 密集帧里抽正好一个步态周期,做无缝 loop。

i2v 的 5s 视频里含 ~2-3 个步态周期,均匀抽 N 帧跨多个周期 → 首尾接缝跳。做法:
帧自相似检测周期(灰度小图,frame[i] 与 frame[i+p] 差最小的 p = 一个周期),
再在一个周期内均匀取 N 帧 → frame[N-1] 的下一拍≈frame[0],循环自然闭合。
纯 numpy / PIL,零 API。
"""
from __future__ import annotations

import numpy as np
from PIL import Image

__all__ = ["find_period", "pick_cycle"]

_SMALL = 48  # 周期检测用的灰度小图边长


def _gray(frames: list[Image.Image]) -> list[np.ndarray]:
    return [np.asarray(f.convert("L").resize((_SMALL, _SMALL)), dtype=np.float32) for f in frames]


def find_period(frames: list[Image.Image], pmin: int | None = None, pmax: int | None = None) -> int:
    """自相似求步态周期(帧数)。frame[i] 与 frame[i+p] 平均差最小的 p。"""
    n = len(frames)
    gs = _gray(frames)
    pmin = pmin or max(4, n // 6)
    pmax = pmax or max(pmin + 1, n // 2)
    best_p, best_d = pmin, float("inf")
    for p in range(pmin, pmax + 1):
        d = float(np.mean([np.abs(gs[i] - gs[i + p]).mean() for i in range(n - p)]))
        if d < best_d:
            best_d, best_p = d, p
    return best_p


def pick_cycle(frames: list[Image.Image], n: int) -> list[Image.Image]:
    """从密集帧里抽正好一个步态周期的 N 帧(无缝 loop)。帧数不足则原样返回。"""
    total = len(frames)
    if total <= n:
        return frames
    gs = _gray(frames)
    p = find_period(frames)
    # 搜起点 i0:让 frame[i0] 与 frame[i0+p] 最像(相位闭合最好)→ 末帧回接首帧最平滑
    i0 = min(range(total - p), key=lambda i: float(np.abs(gs[i] - gs[i + p]).mean()))
    idx = [(i0 + round(k * p / n)) % total for k in range(n)]
    return [frames[i] for i in idx]
