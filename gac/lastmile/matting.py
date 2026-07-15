"""去背景 + 去光晕（alpha）。MS1 桩：pass-through 并标记已抠图；MS2 接 rembg/BiRefNet。"""
from __future__ import annotations
from ..models import FrameSequence


class RembgMatter:
    def cutout(self, seq: FrameSequence) -> FrameSequence:
        for f in seq.frames:
            f.png_path = f.png_path.replace(".png", "_matte.png")
        return seq
