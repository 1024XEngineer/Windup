"""帧序列 + 元数据 → sprite sheet / JSON / GIF（统一输出契约）。MS1 桩：mock 路径。"""
from __future__ import annotations
from .models import FrameSequence, DeliveryPackage


class GridPackager:
    def pack(self, seqs: list[FrameSequence]) -> DeliveryPackage:
        pngs = [fr.png_path for s in seqs for fr in s.frames]
        return DeliveryPackage(
            target_engine="cocos",
            sheet_path="mock/sheet.png",
            frame_pngs=pngs,
            json_meta_path="mock/meta.json",   # 帧坐标/pivot/duration/loop
            gif_path="mock/preview.gif",
        )
