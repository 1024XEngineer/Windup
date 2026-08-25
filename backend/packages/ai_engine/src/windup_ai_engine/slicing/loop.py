"""循环闭合(最后一公里之一,Issue #21)—— 从 i2v 密集帧里抽正好一个步态周期,做无缝 loop。

i2v 的 5s 视频里含 ~2-3 个步态周期,均匀抽 N 帧跨多个周期 → 首尾接缝跳。做法:
帧自相似检测周期(灰度小图,frame[i] 与 frame[i+p] 差最小的 p = 一个周期),
再在一个周期内均匀取 N 帧 → frame[N-1] 的下一拍≈frame[0],循环自然闭合。
纯 numpy / PIL,零 API。
"""
from __future__ import annotations

import numpy as np
from PIL import Image

from ._frames import SMALL as _SMALL
from ._frames import gray as _gray

__all__ = ["find_period", "pick_cycle", "pick_cycle_indices"]


def _deskew(gs: list[np.ndarray]) -> list[np.ndarray]:
    """消掉角色的整体水平平移再比对。i2v 里角色会横着挪(实测走位达画宽 18%),而下游
    :func:`postprocess.pack.align_bottom_center` 本来就会逐帧重新居中 —— 不消平移的话,
    d(p) 被"挪了多远"主导、随 p 单调上升,真周期的凹陷被压平(骷髅走路真周期 56 完全消失,
    只剩 22 的假凹陷)。做法:中值背景差取主体列范围,把质心 roll 到画面中心。"""
    a = np.stack(gs)
    d = np.abs(a - np.median(a, axis=0))
    thr = max(4.0, float(np.percentile(d, 99)) * 0.25)
    out = []
    for g, di in zip(gs, d):
        cols = (di > thr).any(0)
        cx = float(np.where(cols)[0].mean()) if cols.any() else _SMALL / 2
        out.append(np.roll(g, int(round(_SMALL / 2 - cx)), axis=1))
    return out


def _dmat(gs: list[np.ndarray]) -> np.ndarray:
    """全帧对距离矩阵(48x48 灰度平均绝对差),后续所有判据共用,只算一次。"""
    flat = np.stack(gs).reshape(len(gs), -1)
    return np.stack([np.abs(flat - flat[i]).mean(1) for i in range(len(gs))])


def _curve(M: np.ndarray, pmin: int, pmax: int) -> dict[int, float]:
    n = len(M)
    return {p: float(np.mean([M[i, i + p] for i in range(n - p)])) for p in range(pmin, pmax + 1)}


def _prominent_period(curve: dict[int, float], scale: float) -> tuple[int, float] | None:
    """只认"内部局部极小 + 凹陷够深"的 p。曲线单调(无周期)时返回 None,而不是交出边界值。"""
    ps = sorted(curve)
    best = None
    for j in range(1, len(ps) - 1):
        p = ps[j]
        if not (curve[p] <= curve[ps[j - 1]] and curve[p] <= curve[ps[j + 1]]):
            continue
        w = max(3, p // 2)
        lo = [curve[q] for q in ps if p - w <= q < p]
        hi = [curve[q] for q in ps if p < q <= p + w]
        if not lo or not hi:
            continue
        prom = (min(max(lo), max(hi)) - curve[p]) / max(scale, 1e-6)
        if best is None or prom > best[1]:
            best = (p, prom)
    return best


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


def _offsets(P: int, n: int) -> list[int]:
    return [round(k * P / n) for k in range(n)]


def pick_cycle_indices(frames: list[Image.Image], n: int) -> list[int]:
    """与 :func:`pick_cycle` 同一套周期/接缝判据,只返回源下标。

    生产路径用下标再解一遍全分辨率帧,避免把 150 张 720p 常驻到选完。
    """
    if n <= 0:
        # n<=0 没有合法语义。检出周期时 `_offsets(P, 0)` 会走到空 idx 再 IndexError;
        # 测不到周期时旧实现静默返回 [] —— 后者更危险,入口显式拒绝。
        raise ValueError(f"n 必须 >= 1,收到 {n}")
    total = len(frames)
    if total < n:
        # 源帧不够就报错,不再原样返回:长度不足且不报错,下游 frame_durations 按实际长度现算,
        # 帧数与时长表自洽,server 看不出异常,用户拿到的是一段没走完的循环。
        raise ValueError(f"源帧不足:请求 {n} 帧,只有 {total} 帧")
    if total == n:
        return list(range(total))
    M = _dmat(_deskew(_gray(frames)))
    if n == 1:
        # 单帧"循环"没有接缝也没有相位,整套周期/接缝机制全部失效。显式取 medoid:
        # 与全片平均姿态最近的一帧 = 循环停留最久的相位,比 frames[0](i2v 首帧是母版静立姿)
        # 更能代表这个循环。
        return [int(np.argmin(M.mean(1)))]
    adj = np.array([M[i, i + 1] for i in range(total - 1)])
    scale = float(np.median(adj))

    pmin = max(6, min(n, total // 6))
    pmax = min(total - 3, max(pmin + 2, int(total * 0.6)))
    got = _prominent_period(_curve(M, pmin, pmax), scale)
    if got is None or got[1] < 0.25:
        return [round(k * (total - 1) / n) for k in range(n)]

    p = got[0]
    cands = []
    for k in range(1, 4):
        P = k * p
        if P > total - 2:
            break
        offs = _offsets(P, n)
        if len(set(offs)) < n:
            continue
        best = None
        for i0 in range(total - P):
            idx = [i0 + o for o in offs]
            a = float(np.mean([M[idx[j], idx[j + 1]] for j in range(n - 1)]))
            if a < 0.5 * scale:
                continue
            score = M[idx[-1], idx[0]] / max(a, 1e-6)
            if best is None or score < best[0]:
                best = (score, idx)
        if best:
            cands.append((k, best[0], best[1]))
    if not cands:
        return [round(k * (total - 1) / n) for k in range(n)]
    ok = [c for c in cands if c[1] <= 1.2]
    pick = ok[0] if ok else min(cands, key=lambda c: c[1])
    return list(pick[2])


def pick_cycle(frames: list[Image.Image], n: int) -> list[Image.Image]:
    """从密集帧里抽正好一个步态周期的 N 帧(无缝 loop)。返回长度恒等于 ``n``。

    周期检测的三个坑(实测 5 段真 i2v 视频):
    1. d(p) 会被"角色整体平移 + 画质漂移"抬成单调上升 —— 直接取 argmin 会滑到搜索窗边界
       交出**假周期**(走路视频: p 恒等于 pmin)。故只认有足够凹陷深度的内部局部极小,
       测不到就判"无周期",退化成全片均匀取(不硬闭环) —— 硬闭环反而制造接缝。
    2. 搜索窗要覆盖真周期: 上界 n//2 会把 5s 里只有 ~2 个周期的待机挡在窗外(实测真周期 62
       > pmax 60,于是取到边界值);下界要 >= 目标帧数 n,否则 round(k*p/n) 直接产出重复帧。
    3. 谐波: 平移偏置让 d(p) 偏爱短 lag,常选中真周期的 1/2(骷髅走路: 取到 22,真周期 ~56),
       半周期闭环 = 末帧接回首帧时左右腿瞬间互换 = 肉眼可见的"跳一下"。故在 p 的整数倍里
       按**归一化接缝**(末→首 差 / 组内相邻差均值)复选,并保证取样索引互不重复。
    不要在这里接 :mod:`.quality` 的死帧判据 —— 2026-08-07 消融实测(4 段真 i2v)证否:
    ① 用 ``active_span`` 先掐头尾冻结段:``_deskew`` 已经解决了"曲线被不动的帧压平"这个
       问题,再掐只是缩小 i0 的搜索空间、丢掉更优相位起点(奔跑 seam 0.81→2.00);
    ② 取样后按 ``dead_frame_mask`` 就近避让死帧:i2v 死帧占比常达一半(24fps 容器隔帧复制,
       实测 59/121 与 63/121),避让会系统性打乱相位均匀性,反而选中更多死帧(1→3)。
    候选评分里的 ``a < 0.5 * scale`` 已经排掉"几乎不动"的窗口,够用。
    quality 不进选帧(它另有一份出参职责,见 :mod:`.quality`)。

    **已知缺口(2026-08-09 记,未修)**:本函数有四条返回路径,其中三条是 return 帧列表,
    调用方**分不清走了哪条**:
      1. ``total <= n`` 原样返回(源帧比要的还少,根本没选);
      2. 测不到可信周期 → 全片均匀取(**降级**,不闭环);
      3. 候选全被否 → 全片均匀取(**降级**,同上);
      4. 正常闭环。
    2 与 3 的补救方式不同(2 多半是母版/动作幅度问题,该换母版;3 多半是视频里周期数
    不够,该加长视频),但今天都表现为"一组看起来正常的帧"。**降级对交付物的后果**是可测
    的 —— ``ports.ActionQuality.loop_seam`` 在交付帧上量归一化接缝,降级通常表现为接缝
    偏大;但**降级的原因**测不出来。没有顺手把状态塞进返回值,是因为那要改本函数的返回
    形状、波及所有调用方,而今天还没有任何调用方会依据"原因"改变行为。等真有调用方要按
    原因给不同提示时,再让本函数返回 ``(frames, reason)``。
    """
    idx = pick_cycle_indices(frames, n)
    if n == len(frames):
        return frames
    return [frames[i] for i in idx]
