"""ai_engine 串联 smoke —— 验证架构串联成立:路由正确 + generate 端到端跑通。

策略内部(真实 i2v / 图生图)用 mock 顶替(真实生成联网,另有 pixelate 单测覆盖后处理);
本测证明"选路线 → derive → 最后一公里(真实对齐)→ 打包(真实拼图集)→ 资产包"这条串联为真。
"""
from __future__ import annotations

import io

from PIL import Image

from windup_ai_engine.impl import CharacterGenerator
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


def _tiny_png(color=(200, 60, 60, 255)) -> bytes:
    """一张带主体的小 RGBA PNG(四周留透明边,供真实对齐 / 拼图集处理)。"""
    img = Image.new("RGBA", (64, 96), (0, 0, 0, 0))
    for y in range(20, 80):
        for x in range(24, 40):
            img.putpixel((x, y), color)
    buf = io.BytesIO()
    img.save(buf, "PNG")
    return buf.getvalue()


class _NullProgress:
    def step(self, stage: str, i: int, total: int, note: str = "") -> None:
        pass


class _RecordStore:
    def __init__(self) -> None:
        self.puts: list[str] = []

    def put(self, kind: str, data: bytes, meta: dict) -> str:
        ref = f"mock://{kind}/{meta.get('i', meta.get('action', 0))}"
        self.puts.append(ref)
        return ref

    def get(self, ref: str) -> bytes:
        return _tiny_png()


class _CB:
    def __init__(self) -> None:
        self.progress = _NullProgress()
        self.store = _RecordStore()


class _MockWalkStrategy(DerivationStrategy):
    """顶替真实 VideoFrameStrategy:返回 N 张真 PNG,让对齐/打包真跑。"""

    route = GenRoute.VIDEO_I2V

    def derive(self, card, action, cb) -> list[bytes]:
        return [_tiny_png() for _ in range(action.n_frames)]


def _make_generator() -> CharacterGenerator:
    return CharacterGenerator({GenRoute.VIDEO_I2V: _MockWalkStrategy()})


def test_route_matrix_is_the_measured_contract():
    # 实测挣得的架构决策:走路/跑/攻击走视频,受击逐帧,待机程序化
    assert ROUTE_MATRIX[ActionType.WALK] is GenRoute.VIDEO_I2V
    assert ROUTE_MATRIX[ActionType.RUN] is GenRoute.VIDEO_I2V
    assert ROUTE_MATRIX[ActionType.ATTACK] is GenRoute.VIDEO_I2V
    assert ROUTE_MATRIX[ActionType.HIT] is GenRoute.PER_FRAME
    assert ROUTE_MATRIX[ActionType.IDLE] is GenRoute.PROC_IDLE


def test_generate_walk_is_wired_end_to_end():
    card = CharacterCard(name="rogue", desc="hooded ranger, dual daggers", master_ref="mock://master")
    action = ActionSpec(action=ActionType.WALK, poses=["p"] * 8)
    pkg = _make_generator().generate(card, action, _CB())
    assert pkg.character == "rogue"
    assert pkg.action is ActionType.WALK
    assert len(pkg.frame_refs) == 8          # 选路线→derive→对齐→打包 全串通
    assert pkg.sheet_ref                     # 真实拼图集落存储


def test_action_spec_stylize_defaults_and_toggle():
    # 像素化是开关(默认 pixel),可关成 none 保留 i2v 画风
    assert ActionSpec(action=ActionType.WALK).stylize == "pixel"
    a = ActionSpec(action=ActionType.WALK, stylize="none")
    assert a.stylize == "none"


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
