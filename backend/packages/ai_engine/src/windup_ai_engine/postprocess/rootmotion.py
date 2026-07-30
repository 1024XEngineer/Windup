"""Root motion(位移轨迹)与逐帧时长 —— 按 2D 游戏业界惯例分离"姿势"与"位移"。

业界做法(调研 2026-07-28):
- **位移不烘进序列帧**。连续位移动作几乎一律用 *in-place animation + 引擎代码驱动移动*,
  因为玩家要即时操控:跑动中转向应立刻响应,而不是等一段烘死的位移播完。平台游戏的跳跃
  也是"几个姿势定格 + 引擎物理驱动上下",不是把抛物线画进像素。
  → 序列帧保持**原地**(脚线对齐),位移单独作为 root-motion 轨道交给引擎。
- **逐帧时长比帧数更重要**("frame timing beats frame count")。业界常用:
  idle 400–500ms/帧、walk 100–150ms、run 80–100ms、attack 起手 80–100ms 且**触点定格
  150–200ms**。全程等时长会让动作发飘、没有重量感。

本模块只做几何与时长计算,纯 numpy,零 API。
"""

from __future__ import annotations

import numpy as np
from PIL import Image

__all__ = ["extract_root_motion", "frame_durations", "DEFAULT_FPS_MS"]

# 各动作的基准单帧时长(ms),取业界常用区间的中值。
DEFAULT_FPS_MS = {
    "idle": 450,
    "walk": 125,
    "run": 90,
    "jump": 110,
    "attack": 90,
    "hit": 90,
}


def extract_root_motion(frames: list[Image.Image], alpha_thr: int = 128) -> list[tuple[int, int]]:
    """逐帧相对首帧的 (dx, dy) 位移,单位=像素,y 向上为正。

    以主体包围盒的**底边中心**(脚点)为参考点。序列帧本身保持原地时,这条轨道就是引擎
    要施加的 root motion:jump 的 dy 是腾空高度,walk 的 dx 是前进量。
    """
    pts: list[tuple[float, float]] = []
    for f in frames:
        a = np.asarray(f.convert("RGBA"))
        ys, xs = np.where(a[:, :, 3] > alpha_thr)
        pts.append(((xs.min() + xs.max()) / 2, float(ys.max())) if len(ys) else (np.nan, np.nan))
    arr = np.array(pts, dtype=np.float32)
    if np.isnan(arr).any():                       # 空帧用邻近值补
        idx = np.arange(len(arr))
        for c in range(2):
            good = ~np.isnan(arr[:, c])
            arr[:, c] = np.interp(idx, idx[good], arr[good, c]) if good.any() else 0.0
    base = arr[0]
    return [(int(round(p[0] - base[0])), int(round(base[1] - p[1]))) for p in arr]


def frame_durations(
    action: str, n_frames: int, key_frame: int | None = None, hold_ms: int = 180
) -> list[int]:
    """逐帧时长(ms)。关键帧(触点 / 顶点)加长定格,其余用该动作的基准时长。

    Args:
        action: 动作名(取 :data:`DEFAULT_FPS_MS` 的基准时长,未知动作按 walk)。
        n_frames: 帧数。
        key_frame: 要定格的帧下标(attack 的触点、jump 的顶点);None 表示全程等时长。
        hold_ms: 关键帧时长,业界常用 150–200ms。
    """
    base = DEFAULT_FPS_MS.get(action, DEFAULT_FPS_MS["walk"])
    out = [base] * max(0, n_frames)
    if key_frame is not None and 0 <= key_frame < n_frames:
        out[key_frame] = max(base, hold_ms)
    return out
