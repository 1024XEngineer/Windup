"""路线 B：图生视频转帧。可插拔的第二工作流——week1 spike 已验证一致性/平滑度可用（boy 用例甚至优于逐帧）。
当前主线仍为逐帧 route A（保住“单帧可重画”），本模块待 MS2 实现。对齐 PR#2 评审 L201：视频是各工作流之一。"""
from __future__ import annotations
from ..models import CharacterCard, FrameSequence, GenRoute


class RouteBI2VGenerator:
    route = GenRoute.B_I2V

    def generate(self, card: CharacterCard, action_name: str,
                 route: GenRoute = GenRoute.B_I2V) -> FrameSequence:
        raise NotImplementedError(
            "路线 B（图生视频）待 MS2 实现；已验证可行、作可插拔第二工作流，当前主线为逐帧 route A")
