"""ai_engine 串联 smoke —— 验证架构串联成立:路由正确 + generate 端到端跑通。

策略内部(真实 i2v)用 mock / monkeypatch 顶替(真实生成联网、抽帧要解码 mp4);
本测证明"选路线 → derive → 最后一公里(真实对齐)→ GeneratedAction(帧 + 时长)"这条串联为真。
"""
from __future__ import annotations

import io

from PIL import Image

from windup_ai_engine.impl import CharacterGenerator
from windup_ai_engine.ports import GeneratedAction
from windup_ai_engine.strategy import (
    ROUTE_MATRIX,
    DerivationStrategy,
    VideoFrameStrategy,
)
from windup_common.models import (
    ActionSpec,
    ActionType,
    CharacterCard,
    GenRoute,
)


def _tiny_png(color=(200, 60, 60, 255), shift=0) -> bytes:
    """一张带主体的小 RGBA PNG(四周留透明边,供真实对齐 / 抠图链处理)。"""
    img = Image.new("RGBA", (64, 96), (0, 0, 0, 0))
    for y in range(20, 80):
        for x in range(24 + shift, 40 + shift):
            img.putpixel((x, y), color)
    buf = io.BytesIO()
    img.save(buf, "PNG")
    return buf.getvalue()


class _NullProgress:
    def step(self, stage: str, i: int, total: int, note: str = "") -> None:
        pass


class _MockWalkStrategy(DerivationStrategy):
    """顶替真实 VideoFrameStrategy:返回 N 张真 PNG,让对齐真跑。"""

    route = GenRoute.VIDEO_I2V

    def derive(self, card, action, master, progress) -> list[bytes]:
        return [_tiny_png() for _ in range(action.n_frames)]


def _make_generator() -> CharacterGenerator:
    return CharacterGenerator({GenRoute.VIDEO_I2V: _MockWalkStrategy()})


def test_route_matrix_is_the_measured_contract():
    # 实测挣得的架构决策:走路/跑/攻击走视频,受击逐帧,待机程序化
    assert ROUTE_MATRIX[ActionType.WALK] is GenRoute.VIDEO_I2V
    assert ROUTE_MATRIX[ActionType.RUN] is GenRoute.VIDEO_I2V
    assert ROUTE_MATRIX[ActionType.ATTACK] is GenRoute.VIDEO_I2V
    assert ROUTE_MATRIX[ActionType.JUMP] is GenRoute.VIDEO_I2V
    assert ROUTE_MATRIX[ActionType.HIT] is GenRoute.PER_FRAME
    assert ROUTE_MATRIX[ActionType.IDLE] is GenRoute.VIDEO_I2V


def test_generate_walk_is_wired_end_to_end():
    card = CharacterCard(name="rogue", desc="hooded ranger, dual daggers")
    action = ActionSpec(action=ActionType.WALK, poses=["p"] * 8)
    out = _make_generator().generate(card, action, master=_tiny_png(), progress=_NullProgress())
    assert isinstance(out, GeneratedAction)
    assert len(out.frames) == 8                       # 选路线→derive→对齐 全串通
    assert len(out.durations) == 8                    # 逐帧时长与帧等长
    assert out.fps == action.fps
    assert all(f and f[:8] == b"\x89PNG\r\n\x1a\n" for f in out.frames)  # 真 PNG


def test_action_spec_stylize_defaults_and_toggle():
    # 像素化是开关(默认 pixel),可关成 none 保留 i2v 画风
    assert ActionSpec(action=ActionType.WALK).stylize == "pixel"
    a = ActionSpec(action=ActionType.WALK, stylize="none")
    assert a.stylize == "none"


def test_video_strategy_derive_runs_offline(monkeypatch):
    """真实 VideoFrameStrategy.derive 离线跑通(抽帧被顶替,不解码 mp4 / 不联网)。

    证明 derive 的真实链路:i2v → 抽帧 → 抠图 → 选帧 → 出帧,产物是合法 RGBA PNG。
    """
    dense = [Image.open(io.BytesIO(_tiny_png(shift=i % 6))).convert("RGBA") for i in range(24)]
    monkeypatch.setattr(
        "windup_ai_engine.strategy.concrete.extract_all_frames_bytes",
        lambda video, cap=150: dense,
    )

    class _StubVideo:
        def i2v(self, first_frame, prompt, seconds=5, size="1280x720"):
            return b"fake-mp4"

    class _StubMatte:
        def cutout(self, frame):   # 透传:合成帧已带 alpha
            return frame

    strat = VideoFrameStrategy(_StubVideo(), _StubMatte())
    card = CharacterCard(name="knight", desc="plate armor, sword")
    action = ActionSpec(action=ActionType.WALK, stylize="none", poses=["p"] * 8)
    out = strat.derive(card, action, master=_tiny_png(), progress=_NullProgress())
    assert out and all(f[:8] == b"\x89PNG\r\n\x1a\n" for f in out)


def test_real_video_strategy_is_registered_for_video_route():
    # 真实 VideoFrameStrategy 可构造且声明视频路线(derive 联网,不在此跑)
    class _V:
        def i2v(self, first_frame, prompt, seconds=5, size="1280x720"):
            return b""

    class _M:
        def cutout(self, frame):
            return frame

    strat = VideoFrameStrategy(_V(), _M())
    assert strat.route is GenRoute.VIDEO_I2V
