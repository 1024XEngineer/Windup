"""逐帧内容包围盒 / 脚底线检测 + pivot 对齐（差异化内核，最高风险，对应 H6）。
MS1 桩：填 mock bbox/pivot；MS2 填实脚底线检测与对齐算法。"""
from __future__ import annotations
from ..models import FrameSequence, BBox, Pivot


class FootlineAligner:
    def align(self, seq: FrameSequence) -> FrameSequence:
        for f in seq.frames:
            f.bbox = BBox(0, 0, 64, 64)
            f.pivot = Pivot(32.0, 64.0)   # 脚底中心（底边中点）
        return seq
