"""帧质量诊断:死帧(重复/冻结)与坏帧(糊/伪影)的判据。

与 :mod:`.loop` 的分工:loop 负责选帧,本模块只负责"这帧是什么成色"。
2026-08-05 实测(6 个真 i2v 视频):**没有一帧糊帧**,但死帧极多——24fps 容器里
隔一帧就是复制帧(奔跑视频奇偶帧差比 22.5x),有效内容帧率只有 ~11-14fps;
且普遍有起步冻结(头部)或动作衰减停住(尾部)。所以"坏帧"与"死帧"必须分开判、
分开统计——只判一型会漏掉一半。
"""
from __future__ import annotations

import numpy as np

from ._frames import gray as _gray

__all__ = ["active_span", "blur_ratio", "dead_frame_indices", "dead_frame_mask",
           "frame_deltas", "limb_motion", "loop_seam", "motion_scale"]


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


def dead_frame_indices(frames) -> tuple[int, ...]:
    """死帧下标。:func:`dead_frame_mask` 的出参形态转换 —— 掩码是算的时候好用的形态,
    跨出 ai_engine 的契约(``ports.ActionQuality``)要的是"哪几帧",不该让调用方拿着
    一个 numpy 掩码去自己 argwhere。"""
    return tuple(int(i) for i in np.flatnonzero(dead_frame_mask(frames)))


def motion_scale(frames) -> float:
    """相邻帧平均差异的**绝对**尺度(48×48 灰度)。0.0 = 这些帧逐像素完全一样。

    为什么与 :func:`dead_frame_mask` 并存、而不是从它推导:后者两条判据
    (``d[i] < ratio*max(邻居)`` 与 ``d[i] < floor*p75``)**都是相对的**,整段完全
    冻结时 d 全为 0,两条不等式变成 ``0 < 0``,一条都不成立 —— **一帧死帧都报不出**
    (2026-08-09 用全同帧序列实测:12 帧全同,死帧数 0)。相对判据天生看不见"整体
    没动",绝对尺度必须单独给一个。
    """
    d = frame_deltas(frames)
    return float(d[1:].mean()) if len(d) > 1 else 0.0


def loop_seam(frames) -> float | None:
    """末帧接回首帧的跳幅 ÷ 相邻帧平均步长;整段静止(分母为 0)返回 ``None``。

    与 :func:`.loop.pick_cycle` 选帧时的归一化接缝同式,但**测的对象不同**:pick_cycle
    在抠图 / 像素化 / 脚线对齐**之前**的密集帧上打分,而用户看到的是这三步之后的帧,
    这三步都会改动像素。要描述交付物就得在交付物上量。

    不套 :func:`.loop._deskew`:交付帧已被 ``align_bottom_center`` 逐帧居中,整体平移
    早消掉了,再按差分质心对一次只是引入第二套居中口径(两套口径不一致正是本仓反复
    踩的那类静默分歧)。

    分母为 0 时返回 None 而不是 0.0 —— 0.0 会被读成"完美闭环",而真相是"没有可比的
    步长,这个数不可读"。
    """
    gs = _gray(frames)
    if len(gs) < 2:
        return None
    step = float(np.mean([np.abs(gs[i + 1] - gs[i]).mean() for i in range(len(gs) - 1)]))
    if step <= 0.0:
        return None
    return float(np.abs(gs[-1] - gs[0]).mean() / step)


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


def limb_motion(frames, *, grid: tuple[int, int] = (3, 2)) -> dict[str, float]:
    """按身体分区量动量,返回**各区占总动量的比例** + 最静区名 ``still``。

    存在的理由是整幅平均逮不到"一部分肢体在动、另一部分冻着"::func:`motion_scale`
    与 :func:`dead_frame_mask` 的判据都是相对的,整体在动时它们全绿,而"腿在迈、手臂
    僵成柱子"正是**自动绑骨漏认肢体**的典型表现 —— 那块网格没有骨骼驱动,每帧同姿势。

    只报占比、不给合格线:几何分区区分不了"该动没动"和"本来就不该动",那需要动作语义。
    试过的两个汇总判据都不成立 —— ``max/min`` 的分母常落在本就不该动的静区,
    ``max/median`` 在半数区冻结时中位数落到活跃那侧,恰在最该报警时比值 ≈ 1.0。
    故**判决交给调用方**,与 :class:`ports.ActionQuality` 其余读数同一取向。

    读法:6 区均匀分布时各占 ≈0.17;某区接近 0 且按动作语义**该动**,那块多半没被骨骼
    驱动。分区按主体包围盒切(不是整幅画布),否则角色在画面里位置一变区就对不上。
    """
    from ._frames import alpha_stack as _masks

    m = _masks(frames)
    if m.shape[0] < 2:
        return {"still": ""}
    ys, xs = np.where(m.any(0))
    if not len(ys):
        return {"still": ""}
    y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    rows, cols = grid
    hs = np.linspace(y0, y1, rows + 1).astype(int)
    ws = np.linspace(x0, x1, cols + 1).astype(int)
    names_r = ("上", "中", "下")[:rows]
    names_c = ("左", "右")[:cols] if cols == 2 else tuple(str(i) for i in range(cols))

    raw: dict[str, float] = {}
    for r in range(rows):
        for c in range(cols):
            blk = m[:, hs[r]:hs[r + 1], ws[c]:ws[c + 1]]
            raw[f"{names_r[r]}{names_c[c]}"] = float(blk.std(0).sum())
    total = sum(raw.values())
    out: dict[str, float] = {k: round(v / total, 3) if total > 0 else 0.0
                             for k, v in raw.items()}
    # 在**只有分区**的字典上挑最静区,再把它写回去。反过来的话 `still` 会挑中自己写进去
    # 的汇总键 —— 一个只在数据上体现、不会报错的错。
    out["still"] = min(raw, key=lambda k: raw[k])
    return out
