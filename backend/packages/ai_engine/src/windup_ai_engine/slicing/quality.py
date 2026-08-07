"""帧质量诊断:死帧(重复/冻结)与坏帧(糊/伪影)的判据。

与 :mod:`.loop` 的分工:loop 负责选帧,本模块只负责"这帧是什么成色"。
2026-08-05 实测(6 个真 i2v 视频):**没有一帧糊帧**,但死帧极多——24fps 容器里
隔一帧就是复制帧(奔跑视频奇偶帧差比 22.5x),有效内容帧率只有 ~11-14fps;
且普遍有起步冻结(头部)或动作衰减停住(尾部)。所以"坏帧"与"死帧"必须分开判、
分开统计——只判一型会漏掉一半。
"""
from __future__ import annotations

import numpy as np

__all__ = ["active_span", "blur_ratio", "dead_frame_mask", "frame_deltas"]

_SMALL = 48


def _gray(frames):
    return [np.asarray(f.convert("L").resize((_SMALL, _SMALL)), dtype=np.float32) for f in frames]


def frame_deltas(frames) -> np.ndarray:
    """d[i] = |f_i - f_{i-1}| 均值，d[0]=0。小图（48x48 灰度），CPU 便宜。"""
    gs = _gray(frames)
    return np.array([0.0] + [float(np.abs(gs[i] - gs[i - 1]).mean()) for i in range(1, len(gs))])


def dead_frame_mask(frames, ratio: float = 0.35, floor: float = 0.25) -> np.ndarray:
    """死帧 = 相对前一帧几乎没有新内容。两型必须都判，缺一漏一半：

    A 型「隔帧死」: d[i] < ratio * max(d[i-1], d[i+1])
        i2v 常见"有效帧率减半"——24fps 容器里隔一帧就是复制帧。只用全局阈值抓不到，
        因为半数帧是死帧时 median 本身落在死帧堆里（实测 run 奇偶比 9.9x 却报 0 死帧）。
    B 型「持续冻结」: d[i] < floor * p75(d)
        视频头部的 i2v 起步冻结、尾部的动作衰减停住。只用 A 型抓不到，
        因为连续冻结段里邻居同样低，比值≈1（实测 attack 尾部 9 帧全漏）。
    """
    d = frame_deltas(frames) if not isinstance(frames, np.ndarray) else frames
    n = len(d)
    p75 = float(np.percentile(d[1:], 75)) if n > 1 else 0.0
    m = np.zeros(n, dtype=bool)
    for i in range(1, n):
        nb = [d[j] for j in (i - 1, i + 1) if 1 <= j < n]
        if nb and d[i] < ratio * max(nb):
            m[i] = True
        if d[i] < floor * p75:
            m[i] = True
    return m


def active_span(frames, floor: float = 0.25, min_run: int = 3) -> tuple[int, int]:
    """掐掉头尾的**持续**冻结段，返回 [s, e]（闭区间）。中间的隔帧死不动。"""
    d = frame_deltas(frames)
    n = len(d)
    p75 = float(np.percentile(d[1:], 75)) if n > 1 else 0.0
    low = d < floor * p75
    s, e = 0, n - 1
    r = 0
    for i in range(1, n):                       # 头部
        if low[i]:
            r += 1
        else:
            break
    if r >= min_run:
        s = r
    r = 0
    for i in range(n - 1, 0, -1):               # 尾部
        if low[i]:
            r += 1
        else:
            break
    if r >= min_run:
        e = n - 1 - r
    if e - s < 4:                               # 掐过头就放弃
        return 0, n - 1
    return s, e


def blur_ratio(frames, ps: int = 32) -> np.ndarray:
    """逐帧「静止区清晰度 / 前后帧同区清晰度」。<1 = 这帧自己糊了，与动作快慢无关。"""
    def _pm(a):
        h, w = a.shape
        H, W = max(ps, h // ps * ps), max(ps, w // ps * ps)
        a = a[:H, :W]
        return a.reshape(H // ps, ps, W // ps, ps).mean(axis=(1, 3))

    def _ag(g):
        gx = np.zeros_like(g)
        gy = np.zeros_like(g)
        gx[:, 1:-1] = np.abs(g[:, 2:] - g[:, :-2]) * .5
        gy[1:-1, :] = np.abs(g[2:, :] - g[:-2, :]) * .5
        return np.maximum(gx, gy)

    gs = [np.asarray(f.convert("L"), np.float32) for f in frames]
    sharp = np.stack([_pm(_ag(g)) for g in gs])
    out = np.ones(len(gs), np.float32)
    for i in range(1, len(gs) - 1):
        mv = np.maximum(_pm(np.abs(gs[i] - gs[i - 1])), _pm(np.abs(gs[i] - gs[i + 1])))
        ref = .5 * (sharp[i - 1] + sharp[i + 1])
        m = (mv < 2.5) & (ref > 3.0)
        if m.sum() < 4:
            cand = ref > 3.0
            if cand.sum() < 4:
                continue
            k = max(4, int(cand.sum() * .25))
            m = cand & (mv <= np.sort(mv[cand])[:k].max())
        out[i] = float(np.median(sharp[i][m] / np.maximum(ref[m], 1e-6)))
    return out
