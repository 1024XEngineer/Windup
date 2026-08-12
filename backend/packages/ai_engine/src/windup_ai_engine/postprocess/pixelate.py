"""像素化后处理:把生成帧转成脆边限色的像素精灵。

视频路线实测(Issue #35):
- i2v 能解决步态(腿真交替、不转身);对**插画风**角色它保留插画质感 → 需要像素化转风格。
- 对**原生像素**角色 i2v 其实能保住像素感,但链路上两道有损压缩(首帧 JPG q90 + 视频 H.264)
  会在硬边处产生振铃噪点(表现为灰颗粒),像素越细越明显;而通用的"降采样 + 32 色量化"
  因为**网格对不齐**反而更糊。
- 解法:有母版时按 :func:`master_pixel_spec` 量出母版的**原生像素块大小**与**真实色板**,
  按母版网格降采样 + 颜色吸附回母版色板 —— 压缩灰颗粒不属于色板,会被强制消掉。

纯 Pillow / numpy,零 API、秒级,符合"本机只做轻量 CV"的算力约束。
输入约定:RGBA 图(alpha 为主体掩码,抠图见 framework 的 MatteProvider / Issue #20)。
"""

from __future__ import annotations

import numpy as np
from PIL import Image

__all__ = [
    "to_pixel_art",
    "pixelate_frames",
    "detect_pixel_size",
    "extract_palette",
    "master_pixel_spec",
]


def _content_bbox(rgba: Image.Image, alpha_thr: int = 128) -> tuple[int, int, int, int]:
    """求主体包围盒。

    用 :func:`_subject_mask` 而非只看 alpha:母版常是**不透明白底**,只看 alpha 会把整张
    画布当主体,导致逻辑像素高被算成整图高而非角色高(实测踩过)。
    """
    mask = _subject_mask(rgba.convert("RGBA"), alpha_thr)
    ys, xs = np.where(mask)
    if len(ys):
        return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1
    return 0, 0, rgba.width, rgba.height


def _axis_block_size(crop: np.ndarray, axis: int, min_delta: int, min_frac: float) -> int:
    """沿 ``axis`` 估块边长:显著色变位置 → 合并相邻 → 取最常见间距。"""
    d = np.abs(np.diff(crop, axis=axis)).sum(axis=2)
    frac = (d > min_delta).mean(axis=1 - axis)
    edges = np.flatnonzero(frac > min_frac) + 1
    if len(edges) < 3:
        return 1
    # 块边界常因轻微抗锯齿占相邻两行/列,合并成一条,否则 gap=1 会淹没真实值
    edges = edges[np.concatenate([[True], np.diff(edges) > 1])]
    gaps = np.diff(edges)
    gaps = gaps[gaps >= 2]
    return int(np.bincount(gaps).argmax()) if len(gaps) else 1


def detect_pixel_size(
    img: Image.Image, min_delta: int = 30, min_frac: float = 0.02, max_size: int = 64
) -> int:
    """检测像素画的原生像素块边长(非像素画/检测不出时返回 1)。

    原理:像素画的色块边界落在同一网格上,相邻边界间距 = 块边长的整数倍,故取
    **最常见间距**即块边长。两轴分别估,取较小者(更保守,宁可细不可糊)。
    """
    rgba = img.convert("RGBA")
    x0, y0, x1, y1 = _content_bbox(rgba)
    crop = np.asarray(rgba.crop((x0, y0, x1, y1)).convert("RGB")).astype(np.int16)
    if crop.size == 0:
        return 1
    sizes = [_axis_block_size(crop, ax, min_delta, min_frac) for ax in (0, 1)]
    best = min(s for s in sizes) if all(s >= 1 for s in sizes) else 1
    return max(1, min(best, max_size))


def _erode(mask: np.ndarray, k: int) -> np.ndarray:
    """二值腐蚀 k 次(纯 numpy 移位,不引 scipy)。"""
    m = mask
    for _ in range(max(0, k)):
        m = (
            m
            & np.roll(m, 1, 0)
            & np.roll(m, -1, 0)
            & np.roll(m, 1, 1)
            & np.roll(m, -1, 1)
        )
        if not m.any():
            return mask
    return m


def _subject_mask(
    rgba: Image.Image, alpha_thr: int = 128, bg_tol: int = 40, erode: int = 0
) -> np.ndarray:
    """主体掩码:优先用真实 alpha;母版常是**不透明白底**,此时按四角背景色排除背景。

    两个实测踩过的坑:
      1. 不排背景 → 白底占多数像素、吃光色板名额 → 角色被整体吸附成白色。
      2. 排了背景但保留边缘 → 角色/白底之间的**抗锯齿过渡色**(近白)混进色板 →
         视频里的浅色噪点就近吸附成白点,满身白斑。故取色板时用 ``erode`` 腐蚀掉边缘。
    """
    arr = np.asarray(rgba)
    alpha = arr[:, :, 3]
    if not alpha.min() > alpha_thr:          # 有真实抠图
        mask = alpha > alpha_thr
    else:
        rgb = arr[:, :, :3].astype(np.int16)
        corners = np.stack([rgb[0, 0], rgb[0, -1], rgb[-1, 0], rgb[-1, -1]])
        bg = np.median(corners, axis=0)
        mask = np.abs(rgb - bg).sum(axis=2) > bg_tol
    return _erode(mask, erode)


def extract_palette(
    img: Image.Image, max_colors: int = 32, alpha_thr: int = 128, erode: int = 3
) -> np.ndarray:
    """提取母版真实色板,返回 (K,3) uint8。

    只统计主体像素(见 :func:`_subject_mask`,并腐蚀掉抗锯齿边缘),再用中位切分量化
    归并噪声色 —— 生成的"像素画"常带轻微噪点/抗锯齿,同一名义色被打散成大量近似色,
    直接按频率统计会全被当杂色滤掉。
    """
    rgba = img.convert("RGBA")
    arr = np.asarray(rgba)
    mask = _subject_mask(rgba, alpha_thr, erode=erode)
    pixels = arr[:, :, :3][mask]
    if not len(pixels):
        pixels = arr[:, :, :3].reshape(-1, 3)
    strip = Image.fromarray(pixels.reshape(1, -1, 3).astype(np.uint8), "RGB")
    quant = strip.quantize(colors=max(2, max_colors), method=Image.MEDIANCUT)
    pal = np.asarray(quant.getpalette()[: max(2, max_colors) * 3], dtype=np.uint8).reshape(-1, 3)
    used = np.unique(np.asarray(quant))
    return pal[used[used < len(pal)]]


def master_pixel_spec(master: Image.Image, max_colors: int = 48) -> tuple[int, np.ndarray]:
    """从母版量出 (角色的逻辑像素高, 母版色板)。

    逻辑像素高 = 母版里角色占的像素行数 ÷ 原生像素块边长 —— 即"这个角色本来是多少
    像素高的精灵"。用它当 ``target_h`` 可自动吸附网格,不必人肉猜分辨率。

    ``max_colors`` 实测取值:32 太少 —— 中位切分按面积分箱,大面积色(如裸腿肤色/棕靴)
    会挤占名额,小面积但需渐变的衣服色档位不足 → 中间调就近吸到邻近色相(绿衣泛橄榄黄);
    96 太多 —— 抗锯齿近白色重新拿到独立分箱 → 边缘冒白噪点。48 是实测的安全区。
    """
    x0, y0, x1, y1 = _content_bbox(master.convert("RGBA"))
    block = detect_pixel_size(master)
    logical_h = max(1, round((y1 - y0) / block))
    return logical_h, extract_palette(master, max_colors=max_colors)


def _to_perceptual(rgb: np.ndarray) -> np.ndarray:
    """RGB → 近似感知空间(亮度 + 两个色差轴),float32。

    直接在 RGB 里取最近邻会**跳色相**:绿衣的中间调可能被吸到橄榄黄(实测踩过)。
    换成亮度/色差轴并给色差加权后,同色相内的明暗过渡优先匹配,色相跳变被压住。
    这里用 YCbCr 型线性变换(比 Lab 便宜得多,足够拉开色相)。
    """
    f = rgb.astype(np.float32)
    r, g, b = f[..., 0], f[..., 1], f[..., 2]
    y = 0.299 * r + 0.587 * g + 0.114 * b
    cb = b - y
    cr = r - y
    w = 2.0  # 色差权重 >1:宁可亮度差一点,也别换色相
    return np.stack([y, w * cb, w * cr], axis=-1)


def _snap_to_palette(rgb: np.ndarray, palette: np.ndarray) -> np.ndarray:
    """把每个像素吸附到色板中最近的颜色(感知空间最近邻,分块避免大内存)。

    用 float32 感知空间:①避免 int16 平方距离溢出(255² > 32767,实测让绿衣变肉色);
    ②按色相优先匹配,防止 RGB 空间里的跨色相跳变。
    """
    flat = _to_perceptual(rgb).reshape(-1, 3)
    pal_p = _to_perceptual(palette).reshape(-1, 3)
    pal_rgb = palette.astype(np.uint8).reshape(-1, 3)
    out = np.empty((len(flat), 3), dtype=np.uint8)
    step = 65536
    for i in range(0, len(flat), step):
        chunk = flat[i : i + step]
        d = ((chunk[:, None, :] - pal_p[None, :, :]) ** 2).sum(axis=2)
        out[i : i + step] = pal_rgb[d.argmin(axis=1)]
    return out.reshape(rgb.shape)


def to_pixel_art(
    rgba: Image.Image,
    target_h: int = 100,
    palette_size: int = 32,
    alpha_thr: int = 128,
    palette: np.ndarray | None = None,
) -> Image.Image:
    """单帧转像素风,返回小尺寸 RGBA(``target_h`` 高,等比宽)。

    步骤:裁到主体包围盒 → 等比缩到 ``target_h``(NEAREST 网格降采样)→ 限色。
    限色两种模式:
      - ``palette`` 给定(推荐,原生像素角色):**吸附到母版真实色板**,顺带消掉
        JPG/H.264 在硬边留下的灰颗粒。
      - ``palette=None``(插画转像素):按 ``palette_size`` 做八叉树量化。

    Args:
        target_h: 目标像素高;原生像素角色建议用 :func:`master_pixel_spec` 算出的逻辑高。
        palette_size: 无母版色板时的量化色数。
        palette: (K,3) uint8 母版色板。
    """
    if target_h < 1:
        raise ValueError("target_h 必须 >= 1")
    rgba = rgba.convert("RGBA")
    x0, y0, x1, y1 = _content_bbox(rgba, alpha_thr)
    crop = rgba.crop((x0, y0, x1, y1))
    w, h = crop.size
    target_w = max(1, round(w * target_h / h))
    small = crop.resize((target_w, target_h), Image.NEAREST)

    alpha = np.asarray(small)[:, :, 3]
    if palette is not None and len(palette):
        rgb = _snap_to_palette(np.asarray(small.convert("RGB")), palette)
    else:
        rgb = np.asarray(
            small.convert("RGB")
            .quantize(colors=max(2, palette_size), method=Image.FASTOCTREE)
            .convert("RGB")
        )
    out = np.dstack([rgb, alpha]).astype(np.uint8)
    return Image.fromarray(out, "RGBA")


def pixelate_frames(
    frames: list[Image.Image],
    target_h: int = 100,
    palette_size: int = 32,
    palette: np.ndarray | None = None,
    ref_height: float | None = None,
) -> list[Image.Image]:
    """批量像素化一组帧,**整段共用一个缩放系数**,便于打包为 sprite sheet。

    ``target_h`` 是**基准姿态**的目标像素高,其余帧按同一系数等比缩放 —— 不是把每帧都拉
    到等高。逐帧拉等高会把走路自然的身高起伏反向变成"忽大忽小"(实测踩过:蹲下的帧被放大)。

    ``ref_height``:**跨动作一致性的关键**。给定时用它当基准(单位=源图像素),否则用本序列
    最高帧。同一角色的各个动作若各自取自己的最高帧定标,切换状态时角色会忽大忽小 ——
    传入同一个基准(如母版姿态的角色高)即可让 idle/walk/jump/attack 共用一套尺度。
    """
    if not frames:
        return []
    box_h = []
    for f in frames:
        _, y0, _, y1 = _content_bbox(f.convert("RGBA"))
        box_h.append(max(1, y1 - y0))
    scale = target_h / (ref_height if ref_height else max(box_h))
    return [
        to_pixel_art(f, max(1, round(h * scale)), palette_size, palette=palette)
        for f, h in zip(frames, box_h)
    ]
