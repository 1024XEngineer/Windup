"""对齐 / 打包（后处理的收尾：脚线对齐 → sprite sheet / gif）。

抽帧 / 选帧见 :mod:`..slicing`，像素化见 :mod:`.pixelate`，抠图见 framework 的
MatteProvider（#20）。本模块把对齐后的帧拼成交付物。
"""

from __future__ import annotations

from PIL import Image

__all__ = ["CELL", "CORE_THICKNESS", "FILL_H", "FILL_W", "FOOT_LINE",
           "align_bottom_center", "core_span", "sprite_sheet", "save_gif"]

# 交付画布的几何 —— 提成模块常量而不是只当默认参数,是因为**入口预检要按同一套几何
# 判母版能不能装下**(见 master_check.REJECT_ASPECT)。抄一份数字过去就等于埋下
# "改了这里、那边阈值不动"的静默分歧。
CELL = 256          # 方形 cell 边长(交付序列帧的画布)
FOOT_LINE = 0.92    # 脚线在画布中的高度比例
FILL_H = 0.62       # 参考姿态占画布高的比例(留余量给举过头顶的动作)
FILL_W = 0.96       # 主体占画布宽的上限(宽度兜底的天花板)

# "厚"的门槛:某行/列的主体像素数达到该帧最厚行/列的这个比例,才算本体的一部分。
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
    r = np.flatnonzero(rows >= rows.max() * thickness)
    c = np.flatnonzero(cols >= cols.max() * thickness)
    return float(r.max() - r.min()), float(c.max() - c.min())


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
    spans = [s for s in (core_span(f) for f in frames) if s is not None]
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

    # 宽度兜底:上面几条分支只按高度定标,横向长条主体(四足 / 坐骑 / 龙)按同一系数缩放后
    # 会超出画布宽,被下面的 alpha_composite 以负 dest **静默切掉**左右(PIL 不报错)。
    #
    # 这里同样量**本体**宽:拿包围盒宽会让展开的翅膀 / 甩开的长尾把整只角色压小 ——
    # 实测鸟展翅时包围盒宽是本体的 3.8 倍,本体因此缩到 26%。
    widths = [s[1] for s in spans] or [b[2] - b[0] for b in boxes if b]
    scale = min(scale, (cw * fill_w) / max(1.0, max(widths)))

    out = []
    for f, box in zip(frames, boxes):
        if box is None:
            out.append(Image.new("RGBA", (cw, ch), (0, 0, 0, 0)))
            continue
        crop = f.crop(box)
        w = max(1, round(crop.width * scale))
        h = max(1, round(crop.height * scale))
        crop = crop.resize((w, h), Image.NEAREST)
        lift = round((ground - box[3]) * scale) if preserve_lift else 0
        canvas = Image.new("RGBA", (cw, ch), (0, 0, 0, 0))
        canvas.alpha_composite(crop, (cw // 2 - w // 2, int(ch * foot_line) - h - lift))
        out.append(canvas)
    return out


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
