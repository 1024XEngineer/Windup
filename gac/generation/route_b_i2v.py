"""路线 B：图生视频转帧。仅作 timeboxed spike 证伪，不接入主管线（Proposal §8-①）。"""
from __future__ import annotations
from ..models import CharacterCard, FrameSequence, GenRoute


class RouteBI2VGenerator:
    route = GenRoute.B_I2V

    def generate(self, card: CharacterCard, action_name: str,
                 route: GenRoute = GenRoute.B_I2V) -> FrameSequence:
        raise NotImplementedError(
            "路线 B（图生视频）仅作证伪 spike，不接入 MS1 主管线")
