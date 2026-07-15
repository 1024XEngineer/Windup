"""主线路线 A：参考图 + 姿态约束 + 锁身份。MS1 桩：返回 mock 帧序列。"""
from __future__ import annotations
from ..models import CharacterCard, FrameSequence, Frame, LoopMode, GenRoute

_LOOP = {"idle": LoopMode.LINEAR, "walk": LoopMode.LINEAR, "attack": LoopMode.NONE}
_FPS = {"idle": 8, "walk": 10, "attack": 12}
_FRAMES = {"idle": 4, "walk": 6, "attack": 6}


class RouteARefImgGenerator:
    route = GenRoute.A_REFIMG

    def generate(self, card: CharacterCard, action_name: str,
                 route: GenRoute = GenRoute.A_REFIMG) -> FrameSequence:
        n = _FRAMES.get(action_name, 4)
        fps = _FPS.get(action_name, 8)
        frames = [Frame(png_path=f"mock/{action_name}_{i:02d}.png",
                        duration_ms=int(1000 / fps)) for i in range(n)]
        return FrameSequence(action_name=action_name, fps=fps,
                             loop=_LOOP.get(action_name, LoopMode.NONE),
                             frames=frames)
