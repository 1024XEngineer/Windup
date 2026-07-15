"""idle/walk 无缝循环闭合。MS1 桩：pass-through；MS2 填首尾插值/对齐。"""
from __future__ import annotations
from ..models import FrameSequence


class SeamlessLoopCloser:
    def close(self, seq: FrameSequence) -> FrameSequence:
        return seq
