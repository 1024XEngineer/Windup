"""对齐 / 打包（后处理的收尾：脚线对齐 → sprite sheet / gif）。

抽帧 / 选帧见 :mod:`..slicing`，像素化见 :mod:`.pixelate`，抠图见 framework 的
MatteProvider（#20）。本模块把对齐后的帧拼成交付物。
"""

from __future__ import annotations

import logging

import numpy as np
from PIL import Image

_logger = logging.getLogger(__name__)

__all__ = ["CELL", "CORE_THICKNESS", "DRIFT_CX_TOL", "DRIFT_FOOT_TOL",
           "FILL_H", "FILL_W", "FOOT_LINE", "drifted_frames",
           "align_bottom_center", "core_span", "sprite_sheet", "save_gif"]

# 交付画布的几何 —— 提成模块常量而不是只当默认参数,是因为**入口预检要按同一套几何
# 判母版能不能装下**(见 master_check.REJECT_ASPECT)。抄一份数字过去就等于埋下
# "改了这里、那边阈值不动"的静默分歧。
CELL = 256          # 方形 cell 边长(交付序列帧的画布)
FOOT_LINE = 0.92    # 脚线在画布中的高度比例
FILL_H = 0.62       # 参考姿态占画布高的比例(留余量给举过头顶的动作)
FILL_W = 0.96       # 主体占画布宽的上限(宽度兜底的天花板)

# "厚"的门槛:某行/列的主体像素数达到该帧行/列宽度**中位数**的这个比例,才算本体。
# 0.25 之下是延展物(尾巴、翅膀、披风、举起的武器)—— 它们细,本体厚。
CORE_THICKNESS = 0.25


def core_span(frame: Image.Image, thickness: float = CORE_THICKNESS) -> tuple[float, float] | None:
    """本体的 (高, 宽),单位=该帧像素。空帧返回 ``None``。

    **不能拿整体包围盒当"角色多大"** —— 包围盒被任何延展物撑大,而延展物的幅度随动作变,
    于是同一个角色在不同动作里定标出不同尺寸。实测偏差最大到 45%(龙张翼 55.3%、
    鸟展翅 57.0%、人形举武器 68.4%)。

    判据只认厚薄、不认语义:尾巴、翅膀、武器、披风、触手、长发,只要比本体薄就自动排除。
    所以它不带任何体形先验,四足 / 鸟 / 龙 / 人形共用一套。
    """
    import numpy as np

    m = np.asarray(frame)[:, :, 3] > 128
    rows, cols = m.sum(1), m.sum(0)
    if not rows.any():
        return None

    # 行与列的门槛基准不同,因为延展物对两者的污染方向是**相反的**。以一条横展的翅膀为例:
    #   · 它是全图最宽的那**一行** → 行方向若以 max 为基准,门槛被抬到身体之上,身体每行
    #     都判成"细的",量出的本体高只剩 9px(真值 69)。故行用**中位数**:它反映"大部分行
    #     有多宽",不被少数极端行带偏。
    #   · 它又让**大量列**只有 10px 高 → 列方向若以中位数为基准,中位数被压到 10、门槛低到
    #     2,翅膀整条算进本体,量出的本体宽 209px(真值 49)。故列用 **max**。
    # 判据不对称是数据形态决定的,不是漏了统一。
    def span(counts: np.ndarray, base: float) -> float:
        keep = np.flatnonzero(counts >= base * thickness)
        return float(keep.max() - keep.min())

    nz_rows = rows[rows > 0]
    return (span(rows, float(np.median(nz_rows))), span(cols, float(cols.max())))


# 单调漂移的判定门槛(整段首尾相对变化)。低于它的不动 —— 真实身高起伏实测约 4%,
# 把那也当漂移消掉,就成了原设计担心的"蹲下的帧被放大"。
DRIFT_MIN_RATIO = 0.08

# 判定"这是推镜、不是姿态变化"的容差:推镜把整个角色等比放大,高与宽的首尾相对变化应当
# 同号且同量级;真实姿态(深蹲→起跳)只改高、宽度基本不动。取 0.5 = 宽的变化至少要达到
# 高的一半才认推镜 —— 门槛过严会漏掉带轻微形变的真推镜,过松会把 jump 判成漂移。
DRIFT_WIDTH_AGREEMENT = 0.5


def _trend_ratio(values: list[float | None]) -> float | None:
    """逐帧序列的线性趋势首尾相对变化;观测不足或拟合出非正值返回 ``None``。"""
    x = np.array([i for i, v in enumerate(values) if v is not None], dtype=float)
    a = np.array([v for v in values if v is not None], dtype=float)
    if len(a) < 4:
        return None
    k, b = np.polyfit(x, a, 1)
    trend = k * x + b
    if trend.min() <= 0:
        return None
    return float(trend[-1] / trend[0] - 1.0)


def _looks_like_camera_zoom(
    spans: list[float | None], widths: list[float | None], height_ratio: float
) -> bool:
    """高宽是否一起变 —— 区分推镜与真实姿态变化。

    推镜等比放大整个角色,高与宽的趋势同号且同量级;深蹲→起跳只把高拉长,宽基本不动。
    量不出宽度趋势时返回 True,退回旧行为:宁可补偿一次可疑的,也不因为量不到就整段不补。
    """
    width_ratio = _trend_ratio(widths)
    if width_ratio is None:
        return True
    if width_ratio * height_ratio <= 0:            # 反号:一个变大一个变小,不是推镜
        return False
    return abs(width_ratio) >= abs(height_ratio) * DRIFT_WIDTH_AGREEMENT


def scale_drift(
    spans: list[float | None], widths: list[float | None] | None = None
) -> tuple[list[float], float]:
    """把逐帧本体高里的**单调趋势**分离出来,返回(逐帧补偿系数, 首尾相对变化)。

    存在的理由是整段共用一个缩放系数会原样保留 i2v 的推镜:实测线上两段真实产出,
    本体高从 137→165(+20%)与 70→158(+127%),几乎无回落。统一缩放对整段乘同一个数,
    趋势不受影响,于是角色在一个动作内单调变大。

    只除趋势、不逐帧归一:后者会把走路自然的身高起伏(约 4%)一起压平,蹲下的帧被放大、
    伸展的帧被缩小 —— 那正是本模块最初拒绝逐帧归一的原因。对本体高做一次线性拟合,
    补偿拟合值、保留残差,两个目标就不再冲突(实测修后趋势归零,残差 1.5%–6.7%)。

    ``None`` = 空帧(量不到本体):不参与拟合、系数取 1.0,其余帧照常补偿。

    返回的系数以 1.0 为中心(除以均值),所以整段的**平均**尺寸不变,跨动作口径不受影响。
    """
    n = len(spans)
    # 自变量用**真实帧号**而不是压缩后的序号:主要是系数必须落回对应的帧,否则空洞之后
    # 整体错位一帧;顺带也不让空洞压短趋势的时间轴(32 帧缺 1 实测斜率差 3.7%,
    # 落到逐帧系数上 <0.3%)。
    x = np.array([i for i, s in enumerate(spans) if s is not None], dtype=float)
    a = np.array([s for s in spans if s is not None], dtype=float)
    if len(a) < 4:                            # 观测不足:三点拟不出可信趋势,拟合反而制造漂移
        return [1.0] * n, 0.0
    k, b = np.polyfit(x, a, 1)
    trend = k * x + b
    if trend.min() <= 0:                      # 拟合出非正值:数据不适合线性描述,不动
        return [1.0] * n, 0.0
    ratio = float(trend[-1] / trend[0] - 1.0)
    if abs(ratio) < DRIFT_MIN_RATIO:
        return [1.0] * n, ratio
    if widths is not None and not _looks_like_camera_zoom(spans, widths, ratio):
        # 高在变而宽没跟着变 = 真实姿态(深蹲→起跳),不是推镜。补偿它会把高度拉平、
        # 同时把宽度按同一系数缩掉,姿态被压扁。
        return [1.0] * n, ratio
    comp = [1.0] * n
    for i, c in zip(x.astype(int), trend / trend.mean(), strict=True):
        comp[i] = float(c)
    return comp, ratio


def align_bottom_center(
    frames: list[Image.Image],
    cell: int = CELL,
    foot_line: float = FOOT_LINE,
    fill_h: float = FILL_H,
    fill_w: float = FILL_W,
    preserve_lift: bool = False,
    ref_height: float | None = None,
    cell_h: int | None = None,
) -> list[Image.Image]:
    """按脚线对齐到统一画布,消除逐帧画布漂移(Issue #21)。

    **整段共用一个缩放系数**(取全序列最高帧定标),不逐帧归一化 —— 逐帧各自缩放到等高
    会把走路自然的身高起伏(实测约 4%)反向变成"忽大忽小":蹲下的帧被放大、伸展的帧被
    缩小。统一缩放后帧间只剩真实姿态差,尺度稳定。

    水平方向按**主体水平中心**对齐(不含挥出的武器会更好,当前用整体包围盒中心兜底);
    垂直方向按**脚线**(包围盒底边)对齐到 ``foot_line``。

    ``ref_height``:**跨动作一致性的关键**,单位=传入帧的像素高。给定时按它定标,否则按本
    序列最高帧。按最高帧定标会让"举过头顶"的动作整段被缩小去迁就那一帧 —— 实测攻击时
    斧头高举使 bbox 从 485 涨到 660,角色本体因此明显变小;跳跃顶点同理。故传入**参考姿态**
    (站立)的高度,各动作即共用同一本体尺寸。``fill_h`` 默认 0.62,给举过头顶留出余量。

    ``preserve_lift``:腾空位移**默认不烘进像素**(业界:位移交引擎 root motion)。仅在要把
    位移画进序列帧时才开;开启后以序列里最低的脚线为地面基准,保留每帧相对地面的抬升量。

    ``cell``/``cell_h``:交付画布的宽与高,``cell_h=None`` 即方形 ``cell×cell``(默认,
    行为与加这个参数之前逐像素相同)。**要能出非方形画布,是为了让引擎一次就出到项目
    要的 sprite 尺寸、不必在上层再缩一次。** 上层那次二次缩放不是"糊一点"那么简单:
    它用 ``Image.thumbnail`` 补边,而 thumbnail **只缩不放** —— 项目要 512 时 256 的帧
    根本不会被放大,而是原尺寸居中贴进 512 画布,于是这里刚对齐好的脚线(0.92)被挪到
    0.709(2026-08-11 实测),角色不站在地上了,跨动作对齐也一起失效。

    几何按"比例"而不是"像素"表达(``foot_line``/``fill_h``/``fill_w`` 都是比例),所以
    换画布尺寸不改变构图,母版入口预检(``master_check.REJECT_ASPECT`` = 2*FILL_W/FILL_H)
    与出帧仍共用同一套几何 —— 那条阈值里没有 cell,本来就与画布像素尺寸无关。
    """
    import numpy as np

    cw = cell
    ch = cell if cell_h is None else cell_h
    if cw < 1 or ch < 1:
        # 不静默出一张 0×0:PIL 允许建 0 边长的图,后面 alpha_composite 也不报错,
        # 错产物要到落库/前端才暴露。
        raise ValueError(f"交付画布尺寸必须为正,收到 cell={cell} cell_h={cell_h}")

    boxes: list[tuple[int, int, int, int] | None] = []
    for f in frames:
        ys, xs = np.where(np.asarray(f)[:, :, 3] > 128)
        boxes.append(
            (int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1)
            if len(ys)
            else None
        )
    heights = [b[3] - b[1] for b in boxes if b]
    if not heights:
        return [Image.new("RGBA", (cw, ch), (0, 0, 0, 0)) for _ in frames]
    # 定标一律按**本体**跨度,不按包围盒:后者被延展物撑大,而延展物幅度随动作变。
    # 逐帧补偿要按帧号索引系数,故先留一份与 frames 等长、空帧为 None 的原始表。
    core_spans = [core_span(f) for f in frames]
    spans = [s for s in core_spans if s is not None]
    # 腾空模式:以最低脚线(数值最大 = 站在地上)为地面基准,保留每帧的抬升量
    ground = max(b[3] for b in boxes if b) if preserve_lift else 0
    # 定标要把抬升量算进去,否则跳到最高时头顶会顶出画布被切掉
    if preserve_lift:
        need = max((ground - b[3]) + (b[3] - b[1]) for b in boxes if b)
        scale = (ch * fill_h) / max(1, need)
    elif ref_height:
        scale = (ch * fill_h) / ref_height       # 参考姿态定标(跨动作一致)
    elif spans:
        scale = (ch * fill_h) / max(1.0, float(np.median([s[0] for s in spans])))
    else:
        scale = (ch * fill_h) / max(heights)     # 回退:本序列最高帧

    # 宽度上限。两个目标本身是冲突的 —— 延展物越宽,"整帧不越界"就把角色压得越小,
    # 而那恰恰是本函数要消除的忽大忽小。所以不做全局取舍,按**溢出量**分档:
    #
    # 溢出比 = 整帧宽 / 本体宽。它可量,也正好区分开三种情况:
    #   ≤ 1 + EXTREMITY_SLACK  贴身延展物(人形无披风、龙收翼)。整帧本来就装得下,
    #                          直接按本体定标,两个目标不冲突。
    #   中间档                  延展物明显但不夸张。让整帧装进画布 —— 此时压缩幅度有限,
    #                          尺寸偏差还在可接受范围,不值得为它丢像素。
    #   > EXTREMITY_CLIP_AT    延展物远大于本体(展翅、大甩尾)。**保尺寸一致**,让翅尖
    #                          溢出被裁 —— 再压下去角色本体会小到另一个动作的一半,
    #                          那比翅尖缺一点严重得多。
    #
    # 关键是最后这档**不静默**:裁掉多少写进日志,让"丢了像素"可见而不是靠人看图发现。
    core_w = [s[1] for s in spans] or [b[2] - b[0] for b in boxes if b]
    full_w = [b[2] - b[0] for b in boxes if b]
    max_core, max_full = max(1.0, max(core_w)), max(1.0, max(full_w))
    scale = min(scale, (cw * fill_w) / max_core)

    # 整帧装不下时**不为它压缩角色**,让延展物溢出被裁。
    #
    # 这两个目标本身冲突:延展物越宽,"装进画布"就把角色压得越小,而那正是本函数要消除的
    # 忽大忽小。选保尺寸,因为后果不对称 —— 压缩会让同一只角色在两个动作里差到 4 成
    # (实测龙张翼 59%、鸟展翅 59%),而溢出只丢掉翅尖尾尖那几列像素。
    #
    # 试过折中("压缩量小于某个下限时就压"),**没有中间档**:实测 fit/scale 从 1.042 直接
    # 跳到 0.961,跨过了任何合理的窗口。一个永不成立的分支比没有分支更坏。
    #
    # 关键是**不静默**:裁掉多少写进日志,让丢像素可见,而不是靠人看图发现。

    # 逐帧补偿单调漂移。整段共用的 scale 只决定平均尺寸,趋势项由这里除掉;
    # 补偿系数以 1.0 为中心,故平均尺寸与跨动作口径都不变。
    # 空帧照常传给 scale_drift(它按帧号拟合、空位给 1.0)—— 少一个观测不该让整段不补。
    per_frame = [1.0] * len(frames)
    comp, ratio = scale_drift(
        [s[0] if s is not None else None for s in core_spans],
        [s[1] if s is not None else None for s in core_spans],
    )
    if any(c != 1.0 for c in comp):
        per_frame = [1.0 / c for c in comp]
        _logger.info(
            "整段尺度单调漂移 %.1f%%(i2v 推镜),已逐帧补偿;补偿区间 %.3f–%.3f",
            ratio * 100, min(per_frame), max(per_frame),
        )

    if max_full * scale > cw:
        _logger.info(
            "保尺寸一致而不压缩:整帧需 %.0fpx、画布 %dpx,两侧各溢出约 %.0fpx",
            max_full * scale, cw, (max_full * scale - cw) / 2,
        )

    out = []
    for idx, (f, box) in enumerate(zip(frames, boxes)):
        if box is None:
            out.append(Image.new("RGBA", (cw, ch), (0, 0, 0, 0)))
            continue
        crop = f.crop(box)
        fs = scale * per_frame[idx]
        w = max(1, round(crop.width * fs))
        h = max(1, round(crop.height * fs))
        crop = crop.resize((w, h), Image.NEAREST)
        lift = round((ground - box[3]) * fs) if preserve_lift else 0
        canvas = Image.new("RGBA", (cw, ch), (0, 0, 0, 0))
        canvas.alpha_composite(crop, (cw // 2 - w // 2, int(ch * foot_line) - h - lift))
        out.append(canvas)
    return out


# 逐帧锚点相对中位数的容差(比例,相对画布高/宽)。超出即认为该帧生成得偏。
# 用比例而不是像素:交付画布尺寸随项目变,像素阈值在 256 与 512 上不是同一个严格度。
#
# 脚底那档按归档里 58 段真实序列扫出来:0.023 时报 3 段,其中两段目视干净 —— 同批
# 3D 渲出的走路序列自然步态起伏最大到 1.5%,而那两段擦边在 2.5% 与 2.8%。0.028 到
# 0.045 是同一个结论(只剩一段真离群),取这段平台的中点而不是它的下沿。
DRIFT_FOOT_TOL = 0.035   # 脚底线
DRIFT_CX_TOL = 0.047     # 本体横向中心


def drifted_frames(
    frames: list[Image.Image],
    foot_tol: float = DRIFT_FOOT_TOL,
    cx_tol: float = DRIFT_CX_TOL,
) -> tuple[int, ...]:
    """挑出脚底或横向中心明显偏离全序列中位数的帧下标。

    **量的是对齐之前的原始帧**:``align_bottom_center`` 会把每帧摆正,对齐后再量恒为 0,
    那时偏差已经被搬运掉、但生成本身歪没歪的信息也一起没了。这里要的正是后者 ——
    一帧的角色站位与其余帧差得远,通常是那一帧生成坏了(姿态崩、主体缺失、多出人物)。

    判据用**中位数**不用均值:坏帧本身会把均值拖过去,于是所有帧看起来都"没偏多少"。

    横向中心取本体跨度的中心而不是包围盒中心 —— 见 :func:`_core_columns`。
    """
    import numpy as np

    feet: list[tuple[int, float]] = []
    cxs: list[tuple[int, float]] = []
    empty: set[int] = set()
    for i, f in enumerate(frames):
        a = np.asarray(f)[:, :, 3]
        ys, xs = np.where(a > 128)
        if not len(ys):
            # 整帧没有主体就是本函数要找的那种坏帧(抠图抠穿、生成漏了角色),不是
            # "没测到"。它不进中位数、直接进结果,也不受下面那道观测数下限的约束 ——
            # 一帧全透明这件事本身不需要参照就能判。
            empty.add(i)
            continue
        feet.append((i, float(ys.max())))
        core = _core_columns(a > 128)
        if core is None:
            continue
        cxs.append((i, float(sum(core) / 2)))
    if len(feet) < 3:
        return tuple(sorted(empty))      # 观测太少,中位数不成立

    h = frames[0].size[1]
    w = frames[0].size[0]
    bad = _outliers(feet, foot_tol * h)
    bad |= _outliers(cxs, cx_tol * w)
    return tuple(sorted(bad | empty))


def _core_columns(mask) -> tuple[int, int] | None:
    """本体占据的首尾列。判据与 :func:`core_span` 的列方向一致(以最厚的列为基准)。

    不用整体包围盒:延展物的幅度随动作变,而它对中心的拉扯不是角色站位变了。实测一段
    斧战士序列,斧头从举过头顶甩到水平前伸,包围盒中心一帧跳 38px(画布宽 256),
    本体中心几乎不动 —— 按包围盒判,20 帧里 11 帧被误报成站位漂移。
    """
    import numpy as np

    cols = mask.sum(axis=0)
    if not cols.any():
        return None
    keep = np.flatnonzero(cols >= float(cols.max()) * CORE_THICKNESS)
    if not len(keep):
        return None
    return int(keep.min()), int(keep.max())


def _outliers(obs: list[tuple[int, float]], tol: float) -> set[int]:
    """按中位数判离群;整段有净位移时先把这条直线除掉。

    两种误报要同时躲开,而它们要求相反的处理:

    - **净位移**(角色一路向右走):不除趋势的话后半段整片被判离群。实测一段斧战士序列
      连续 7 帧横偏稳定在 30px 上下、脚偏全 0 —— 那是走位。
    - **周期摆动**(原地走路、四足步态):除趋势反而制造离群。实测一段狼序列脚底是
      1342/1370/1352/1377 循环三遍、净位移为 0,而逐帧差分的中位数给出 25px/帧 的
      假斜率,残差被推到 ±120px,整段 12 帧报出 8 帧。

    判据因此看**首尾净变化**而不是逐帧差分:周期序列首尾回到同一点,净变化接近 0,
    不触发除趋势;真的一路位移才触发。
    """
    import numpy as np

    if len(obs) < 4:
        med = float(np.median([v for _, v in obs])) if obs else 0.0
        return {i for i, v in obs if abs(v - med) > tol}

    x = np.array([i for i, _ in obs], dtype=float)
    y = np.array([v for _, v in obs], dtype=float)
    # 首尾各取三帧的中位数比,单帧首尾正好是坏帧时会把整条判据带偏。
    head = float(np.median(y[:3]))
    tail = float(np.median(y[-3:]))
    # 斜率的分母取这两个中位数**各自对应的帧位**,不取序列总长:三帧窗口的中位数落在窗口
    # 中间那一帧上,拿总长当分母会把斜率算小。实测 16 帧每帧横移 13px 的线性序列,按总长
    # 算出 11.27/帧,两端各剩 13px 残差、双双越过 12.03 的容差,匀速位移被误报成坏帧。
    head_i = float(np.median(x[:3]))
    tail_i = float(np.median(x[-3:]))
    # 无条件除趋势,不设"位移够大才除"的门槛:那个门槛会造一个悬崖 —— 实测一段打捞员
    # 走路净位移 24.0px、容差 24.1px,差 0.1 就不除趋势,于是首两帧被误报。周期序列首尾
    # 回到同一点、净位移≈0,减掉一条≈0 的直线是空操作,所以无条件除对它们无害。
    if tail_i > head_i:
        y = y - (tail - head) / (tail_i - head_i) * x
    med = float(np.median(y))
    return {int(i) for i, v in zip(x, y) if abs(v - med) > tol}


def sprite_sheet(frames: list[Image.Image], bg=(0, 0, 0, 0)) -> Image.Image:
    """横向拼接为 sprite sheet。"""
    if not frames:
        raise ValueError("frames 为空")
    w, h = frames[0].size
    sheet = Image.new("RGBA", (w * len(frames), h), bg)
    for i, f in enumerate(frames):
        sheet.alpha_composite(f.convert("RGBA"), (i * w, 0))
    return sheet


def save_gif(frames: list[Image.Image], path: str, duration: int = 120) -> None:
    """导出循环 gif 供预览。"""
    if not frames:
        raise ValueError("frames 为空")
    rgba = [f.convert("RGBA") for f in frames]
    rgba[0].save(path, save_all=True, append_images=rgba[1:], duration=duration, loop=0, disposal=2)
