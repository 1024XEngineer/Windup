"""PNG bytes ↔ PIL 的唯一转换口。

管线内部按 ``PIL.Image`` 处理,跨模块边界(strategy → generator → ports 出参)按 PNG
bytes 传递。这对转换此前在 ``strategy.concrete`` 与 ``impl.character_generator`` 各写
了一份,收成一处 —— 编码参数(如是否强制 RGBA)一旦分叉,会在"某些帧丢了 alpha"这类
只在画面上体现、不报错的地方出问题。
"""
from __future__ import annotations

import io

from PIL import Image

__all__ = ["to_png", "from_png"]


def to_png(img: Image.Image) -> bytes:
    """PIL → PNG bytes。统一转 RGBA:下游脚线对齐靠 alpha 求包围盒。"""
    buf = io.BytesIO()
    img.convert("RGBA").save(buf, "PNG")
    return buf.getvalue()


def from_png(png: bytes) -> Image.Image:
    """PNG bytes → RGBA 图。"""
    return Image.open(io.BytesIO(png)).convert("RGBA")
