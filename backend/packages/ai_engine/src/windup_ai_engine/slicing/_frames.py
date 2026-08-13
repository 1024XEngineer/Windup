"""选帧与帧质量共用的取样原语。

``loop``(选帧)与 ``quality``(诊断)必须在**同一尺度**上看帧,否则两边算出的差异量
不可比 —— 之前两处各自持有一份 ``_gray`` 与 ``_SMALL``,调一边不会波及另一边,
是一个只会在数据上体现、不会报错的隐患。此处收成唯一定义。
"""
from __future__ import annotations

import numpy as np
from PIL import Image

__all__ = ["SMALL", "gray", "alpha_stack"]

# 帧比对统一降采样到 48×48 灰度:够分辨姿态差异,又让全帧对距离矩阵的开销可接受。
SMALL = 48


def gray(frames: list[Image.Image]) -> list[np.ndarray]:
    """帧序列 → 定尺灰度矩阵列表(float32)。"""
    return [np.asarray(f.convert("L").resize((SMALL, SMALL)), dtype=np.float32) for f in frames]


# 分区动量用的尺度。比 SMALL 大,因为它要在**主体包围盒内**再切 3×2 个区 ——
# 48×48 切完每区只剩 16×24,一条手臂占不到几个像素,量出来的差异全是量化噪声。
MASK = 128


def alpha_stack(frames: list[Image.Image]) -> np.ndarray:
    """帧序列 → ``(n, MASK, MASK)`` 的主体掩码栈(bool)。

    用 alpha 而不是灰度:这些帧是抠过图的 RGBA,alpha 就是主体轮廓,而灰度会把
    深色衣服和透明背景混为一谈。没有 alpha 时退化成"非纯黑即主体"。
    """
    out = []
    for fr in frames:
        im = fr.resize((MASK, MASK))
        if im.mode == "RGBA":
            out.append(np.asarray(im.getchannel("A")) > 128)
        else:
            out.append(np.asarray(im.convert("L")) > 8)
    return np.stack(out)
