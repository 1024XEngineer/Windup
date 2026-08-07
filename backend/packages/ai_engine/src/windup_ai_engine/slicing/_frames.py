"""选帧与帧质量共用的取样原语。

``loop``(选帧)与 ``quality``(诊断)必须在**同一尺度**上看帧,否则两边算出的差异量
不可比 —— 之前两处各自持有一份 ``_gray`` 与 ``_SMALL``,调一边不会波及另一边,
是一个只会在数据上体现、不会报错的隐患。此处收成唯一定义。
"""
from __future__ import annotations

import numpy as np
from PIL import Image

__all__ = ["SMALL", "gray"]

# 帧比对统一降采样到 48×48 灰度:够分辨姿态差异,又让全帧对距离矩阵的开销可接受。
SMALL = 48


def gray(frames: list[Image.Image]) -> list[np.ndarray]:
    """帧序列 → 定尺灰度矩阵列表(float32)。"""
    return [np.asarray(f.convert("L").resize((SMALL, SMALL)), dtype=np.float32) for f in frames]
