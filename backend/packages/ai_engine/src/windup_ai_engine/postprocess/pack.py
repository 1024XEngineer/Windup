"""对齐 / 打包（后处理的收尾：脚线对齐 → sprite sheet / gif）。

抽帧 / 选帧见 :mod:`..slicing`，像素化见 :mod:`.pixelate`，抠图见 framework 的
MatteProvider（#20）。本模块把对齐后的帧拼成交付物。
"""

from __future__ import annotations

from PIL import Image

__all__ = ["align_bottom_center", "sprite_sheet", "save_gif"]


def align_bottom_center(
    frames: list[Image.Image],
    cell: int = 256,
    foot_line: float = 0.92,
    fill_h: float = 0.62,
    preserve_lift: bool = False,
    ref_height: float | None = None,
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
    """
    import numpy as np

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
        return [Image.new("RGBA", (cell, cell), (0, 0, 0, 0)) for _ in frames]
    # 腾空模式:以最低脚线(数值最大 = 站在地上)为地面基准,保留每帧的抬升量
    ground = max(b[3] for b in boxes if b) if preserve_lift else 0
    # 定标要把抬升量算进去,否则跳到最高时头顶会顶出画布被切掉
    if preserve_lift:
        need = max((ground - b[3]) + (b[3] - b[1]) for b in boxes if b)
        scale = (cell * fill_h) / max(1, need)
    elif ref_height:
        scale = (cell * fill_h) / ref_height     # 参考姿态定标(跨动作一致)
    else:
        scale = (cell * fill_h) / max(heights)   # 回退:本序列最高帧

    out = []
    for f, box in zip(frames, boxes):
        if box is None:
            out.append(Image.new("RGBA", (cell, cell), (0, 0, 0, 0)))
            continue
        crop = f.crop(box)
        w = max(1, round(crop.width * scale))
        h = max(1, round(crop.height * scale))
        crop = crop.resize((w, h), Image.NEAREST)
        lift = round((ground - box[3]) * scale) if preserve_lift else 0
        canvas = Image.new("RGBA", (cell, cell), (0, 0, 0, 0))
        canvas.alpha_composite(crop, (cell // 2 - w // 2, int(cell * foot_line) - h - lift))
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
