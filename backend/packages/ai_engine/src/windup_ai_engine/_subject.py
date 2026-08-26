"""「哪些像素是主体」的唯一定义(母版预检 / 脚线 / 补边背景色共用)。

此前这套判据有两份:``master_prep._bg_color`` 取四角中位色补边,
``slicing.oneshot._subject_rows`` 用同一套四角中位色 + 容差找脚线。入口预检
(:mod:`.master_check`)必须与下游用**同一个**主体定义 —— 判据一旦分叉就会出现
"预检说有主体、下游找不到主体"这种只在画面上体现、不报错的分歧,和
:mod:`._imgio` / :mod:`.slicing._frames` 当初被收拢是同一个理由。

判据本身:有真 alpha(存在低于阈值的像素)就用 alpha;整幅不透明(原始视频帧 /
RGB 母版)则按四角中位背景色的差值。**这是颜色启发式,不是抠图模型** ——
背景带渐变、或角色与背景同色时判不准,见 :func:`subject_mask`。
"""
from __future__ import annotations

import numpy as np
from PIL import Image

__all__ = ["bbox_of", "bg_color", "subject_bbox", "subject_mask"]

ALPHA_THR = 128   # alpha 高于此值算不透明(与 postprocess.pack 求包围盒的口径一致)
BG_TOL = 60       # 与背景色的 RGB 绝对差之和,超过才算主体


def _bg_median(rgb: np.ndarray) -> np.ndarray:
    """四角中位色(float)。母版 / 视频帧通常是纯色底,四角取中位比取均值抗单角污染。"""
    corners = np.stack([rgb[0, 0], rgb[0, -1], rgb[-1, 0], rgb[-1, -1]])
    return np.median(corners, axis=0)


def bg_color(img: Image.Image) -> tuple[int, int, int]:
    """背景色(取整),给补边用。"""
    rgb = np.asarray(img.convert("RGB"))
    return tuple(int(v) for v in _bg_median(rgb))


def subject_mask(
    img: Image.Image, alpha_thr: int = ALPHA_THR, bg_tol: int = BG_TOL
) -> np.ndarray:
    """主体像素的二维布尔掩码。

    必须兼容**不透明**输入:抽帧阶段拿到的是原始视频帧,还没抠图,只看 alpha 会把
    整幅当主体、脚线恒定,腾空判据立刻误判"已落地"(实测踩过,跳跃被裁在起跳前)。

    判不准的已知情形(调用方别当成抠图):背景有渐变 → 整幅都超容差,掩码≈全 True;
    角色主色与背景色接近 → 那部分身体被判成背景。要真分割请走 MatteProvider。
    """
    arr = np.asarray(img.convert("RGBA"))
    alpha = arr[:, :, 3]
    if not alpha.min() > alpha_thr:          # 存在透明像素 = 有真 alpha,直接用
        return alpha > alpha_thr
    rgb = arr[:, :, :3].astype(np.int16)
    return np.abs(rgb - _bg_median(rgb)).sum(axis=2) > bg_tol


def bbox_of(mask: np.ndarray) -> tuple[tuple[int, int, int, int], int] | None:
    """已有掩码时的包围盒 + 像素数。

    单独拆出来是为了让**同时要掩码和包围盒**的调用方(母版预检要在掩码上再数横向连通段)
    只算一次掩码;若让它自己从掩码求包围盒,那份口径就与本模块分叉了。
    """
    ys, xs = np.where(mask)
    if not len(ys):
        return None
    box = (int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1)
    return box, int(mask.sum())


def subject_bbox(
    img: Image.Image, alpha_thr: int = ALPHA_THR, bg_tol: int = BG_TOL
) -> tuple[tuple[int, int, int, int], int] | None:
    """主体包围盒 ``(x0, y0, x1, y1)``(半开,同 PIL crop)+ 主体像素数;无主体返回 None。

    包围盒与像素数一起返回:两者判的不是同一件事 —— 包围盒管"主体有多大",
    像素数管"包围盒里是不是真有东西"(散落的几粒噪点能把包围盒撑满整幅)。
    """
    return bbox_of(subject_mask(img, alpha_thr, bg_tol))
