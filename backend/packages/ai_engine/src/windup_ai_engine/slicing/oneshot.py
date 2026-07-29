"""一次性动作(jump / attack / hit)的抽帧:裁动作起止 + 按状态切段。

与循环类(idle/walk/run)的根本差别:
- 循环类用 :mod:`.loop` 找步态周期抽单周期闭环;一次性动作**不能闭环** —— 首尾姿态不同,
  强行闭环会把落地帧接回蓄力帧,读起来是抽搐。
- i2v 出的 5s 视频里,真正的动作往往只占中间一段(前后是静止的起手/终态保持),直接均匀
  抽帧会浪费一半帧在不动的地方 → 需要先**裁到动作发生的区间**。
- jump 还要进一步**按状态切段**(蓄力/上升/顶点/下降/落地),因为引擎里悬空时长由物理
  决定、上升中可被打断,必须能分段播放。

纯 numpy / PIL,零 API。
"""

from __future__ import annotations

import numpy as np
from PIL import Image

__all__ = [
    "find_motion_span",
    "first_action_end",
    "pick_oneshot",
    "split_jump_phases",
    "foot_line_series",
]


def _frame_energy(frames: list[Image.Image], size: int = 64) -> np.ndarray:
    """逐帧与前一帧的差异强度(灰度小图),长度 = len(frames)-1。"""
    gs = [np.asarray(f.convert("L").resize((size, size)), dtype=np.float32) for f in frames]
    return np.array([np.abs(gs[i + 1] - gs[i]).mean() for i in range(len(gs) - 1)])


def find_motion_span(frames: list[Image.Image], rel_thr: float = 0.25) -> tuple[int, int]:
    """定位"动作真正发生"的帧区间 ``[start, end]``(含端点)。

    以帧间差异强度超过峰值 ``rel_thr`` 倍的最早/最晚位置为界,并各留一帧余量。
    静止的起手与终态保持会被裁掉。
    """
    if len(frames) < 3:
        return 0, len(frames) - 1
    e = _frame_energy(frames)
    peak = float(e.max())
    if peak <= 1e-6:
        return 0, len(frames) - 1
    active = np.flatnonzero(e >= peak * rel_thr)
    if not len(active):
        return 0, len(frames) - 1
    start = max(0, int(active[0]) - 1)
    end = min(len(frames) - 1, int(active[-1]) + 2)
    return start, end


def _airborne_end(frames: list[Image.Image], start: int, end: int, tol: float = 6.0) -> int:
    """腾空类(jump)的结束:脚线越过最高点后**首次回到地面**。

    几何信号,明确无歧义 —— 比任何"能量安静"判据都稳。
    """
    y = foot_line_series(frames[start : end + 1])
    if len(y) < 4:
        return end
    apex = int(np.argmin(y))
    ground = float(np.median([y[0], y[-1]]))
    back = np.flatnonzero(y[apex:] >= ground - tol)
    return min(end, start + apex + int(back[0]) + 2) if len(back) else end


def _swing_end(frames: list[Image.Image], start: int, end: int,
               drop_ratio: float = 0.35, recover: int = 2) -> int:
    """挥击类(attack/hit)的结束:能量越过峰值后**首次跌到峰值的 ``drop_ratio``**,再留收势余量。

    挥击是"蓄力 → 峰值 → 收势"的单峰结构,收势很短,故用"跌破比例 + 固定余量"即可;
    不要求长时间静止 —— 实测挥砍收势段的能量并不干净(视频压缩噪点),等不到静止平台。
    """
    e = _frame_energy(frames[start : end + 1])
    if len(e) < 4:
        return end
    peak_i = int(np.argmax(e))
    thr = float(e.max()) * drop_ratio
    for i in range(peak_i + 1, len(e)):
        if e[i] < thr:
            return min(end, start + i + recover)
    return end


def first_action_end(
    frames: list[Image.Image], start: int, end: int, kind: str = "swing"
) -> int:
    """在 ``[start, end]`` 内找**第一次**动作的结束帧,按动作物理分流。

    i2v 常在 5s 里把一次性动作**复读第二遍**(实测:提示词写了 "ONCE",兽人跳了两次、
    挥砍也挥了两次),不裁会把两次动作压进一套序列帧。

    不同动作的"结束"信号本质不同,**一个通用判据管不了两种**(实测踩过):
      - ``kind="airborne"``(jump):脚线回到地面 —— 几何、无歧义。
      - ``kind="swing"``(attack/hit):能量跌破峰值比例 + 收势余量。

    三个已验证无效的通用解法(别再试):①只看"帧间安静" → 在跳跃**顶点悬停**处误触发,
    把动作截在半空;②要求静止段足够长 → 挥砍收势并不干净(压缩噪点),等不到,完全不裁;
    ③找"回到起始姿态"的谷底 → 收势姿态(戒备)与起始姿态(蓄力)不同,回不到低位。
    """
    if end - start < 4:
        return end
    return (_airborne_end if kind == "airborne" else _swing_end)(frames, start, end)


def pick_oneshot(
    frames: list[Image.Image], n: int, first_only: bool = True, kind: str = "swing"
) -> list[Image.Image]:
    """一次性动作抽 ``n`` 帧:裁到动作区间 → 只留第一次动作 → 区间内均匀取(不闭环)。

    ``first_only`` 默认开:防 i2v 在 5s 内复读第二遍动作被一起抽进来。
    ``kind``:``"airborne"``(jump,按脚线回地判结束)或 ``"swing"``(attack/hit,按能量跌破判)。
    """
    if len(frames) <= n:
        return frames
    start, end = find_motion_span(frames)
    if first_only:
        end = max(start + 1, first_action_end(frames, start, end, kind=kind))
    span = frames[start : end + 1]
    if len(span) <= n:
        return span
    idx = [round(i * (len(span) - 1) / (n - 1)) for i in range(n)]
    return [span[i] for i in idx]


def _subject_rows(frame: Image.Image, alpha_thr: int = 128, bg_tol: int = 60) -> np.ndarray:
    """主体所在的行下标。有真实 alpha 用 alpha;**全不透明帧**(原始视频帧)按四角背景色判。

    必须兼容不透明帧:抽帧阶段拿到的是原始视频帧,还没抠图,只看 alpha 会把整幅当主体、
    脚线恒定,导致腾空判据立刻误判"已落地"(实测踩过,跳跃被裁在起跳前)。
    """
    arr = np.asarray(frame.convert("RGBA"))
    alpha = arr[:, :, 3]
    if not alpha.min() > alpha_thr:
        return np.where(alpha > alpha_thr)[0]
    rgb = arr[:, :, :3].astype(np.int16)
    corners = np.stack([rgb[0, 0], rgb[0, -1], rgb[-1, 0], rgb[-1, -1]])
    bg = np.median(corners, axis=0)
    return np.where(np.abs(rgb - bg).sum(axis=2) > bg_tol)[0]


def foot_line_series(frames: list[Image.Image], alpha_thr: int = 128) -> np.ndarray:
    """逐帧主体**底边** y 坐标(脚线)。跳跃时脚线先降(蹲)、再升(腾空)、再落回。"""
    out = []
    for f in frames:
        ys = _subject_rows(f, alpha_thr)
        out.append(float(ys.max()) if len(ys) else np.nan)
    arr = np.array(out, dtype=np.float32)
    if np.isnan(arr).any():                      # 空帧用邻近值补
        idx = np.arange(len(arr))
        good = ~np.isnan(arr)
        if good.any():
            arr = np.interp(idx, idx[good], arr[good])
        else:
            arr = np.zeros_like(arr)
    return arr


def split_jump_phases(frames: list[Image.Image]) -> dict[str, list[int]]:
    """按脚线轨迹把跳跃切成 crouch / rise / apex / fall / land 五段,返回每段的帧下标。

    判据:脚线 y 越小 = 人越高。最高点(y 最小)即 apex;起跳前脚线最低(蹲)处为 crouch
    结束;之后到 apex 为 rise,apex 之后到脚线回到地面高度为 fall,余下为 land。
    只依赖几何,不依赖模型。
    """
    n = len(frames)
    if n < 5:
        return {"rise": list(range(n))}
    y = foot_line_series(frames)
    apex = int(np.argmin(y))                     # 最高点
    ground = float(np.median([y[0], y[-1]]))     # 地面脚线
    # 起跳点:apex 之前脚线最低(数值最大 = 蹲得最深)的位置
    takeoff = int(np.argmax(y[: max(1, apex)])) if apex > 0 else 0
    # 落地点:apex 之后脚线首次回到地面附近
    after = y[apex:]
    back = np.flatnonzero(after >= ground - 2)
    landing = apex + int(back[0]) if len(back) else n - 1

    apex_lo = max(takeoff + 1, apex - 1)
    apex_hi = min(landing - 1, apex + 1)
    phases = {
        "crouch": list(range(0, takeoff + 1)),
        "rise": list(range(takeoff + 1, apex_lo)),
        "apex": list(range(apex_lo, apex_hi + 1)),
        "fall": list(range(apex_hi + 1, landing)),
        "land": list(range(landing, n)),
    }
    return {k: v for k, v in phases.items() if v}
