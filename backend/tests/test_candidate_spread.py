"""候选跨型号铺开。

分配函数自己对不够 —— 算出一张表却没接到出图那个循环时,生产仍旧三张同型号,
既不报错也不生效。所以有一组用例从 ImageTaskExecutor 进,数实际发出去的型号。
"""
from __future__ import annotations

import pytest
from windup_framework.config.provider import AIProviderSettings
from windup_framework.gateway.circuit import CircuitBreaker
from windup_framework.gateway.context import bind_call_context
from windup_framework.gateway.image import ImageGateway
from windup_framework.gateway.registry import ModelRegistry, candidate_models
from windup_common.enums.model import ModelErrorType

GPT = "gpt-image-2"
FLASH = "gemini-3.1-flash-image-preview"
CHAIN = (GPT, FLASH)


@pytest.mark.parametrize(
    ("n", "expect"),
    [
        (1, (GPT,)),
        (2, (GPT, FLASH)),
        (3, (GPT, GPT, FLASH)),          # 三张候选:两张主 + 一张备
        (4, (GPT, GPT, GPT, FLASH)),
    ],
)
def test_spread_gives_the_last_candidate_to_the_second_model(n, expect):
    assert candidate_models(CHAIN, n) == expect


def test_single_model_chain_uses_it_for_every_candidate():
    assert candidate_models((GPT,), 3) == (GPT, GPT, GPT)


def test_empty_chain_yields_nothing_rather_than_a_bogus_model():
    assert candidate_models((), 3) == ()


def test_spread_never_returns_fewer_slots_than_candidates():
    """少一格会让出图循环按下标取时越界,越界发生在付费调用之前还是之后取决于顺序。"""
    for n in range(1, 9):
        assert len(candidate_models(CHAIN, n)) == n


# ── 网关:指定起点后仍要有兜底 ──────────────────────────────────────────────

class _FakeAdapter:
    """按型号给结果;记下实际被调用的型号顺序。"""

    def __init__(self, results: dict[str, list]) -> None:
        self.results = results
        self.seen: list[str] = []

    def submit_image(self, prompt, refs, model):
        self.seen.append(model)
        from windup_framework.gateway.types import AdapterResult

        out = self.results.get(model)
        if not out:
            # UPSTREAM_FAILED 才是"这个型号不行、换下一个"的那类失败;没有 error_type 的
            # 失败会被判成不可重试,链根本不会往下走。
            return AdapterResult(ok=False, error_type=ModelErrorType.INVALID_RESPONSE)
        return out.pop(0)


def _gw(adapter):
    cfg = AIProviderSettings(image_model=GPT, image_fallbacks=FLASH, video_model="kling-v2-5-turbo")
    return ImageGateway(ModelRegistry.from_settings(cfg), adapter, CircuitBreaker(), cfg)


def _ok(body=b"\x89PNG" + b"0" * 6000):
    from windup_framework.gateway.types import AdapterResult

    return AdapterResult(ok=True, body=body, http_status=200)


def test_starting_at_the_last_model_still_falls_back_to_the_first():
    """轮转而非截断:否则被指到链尾的那张候选一旦上游挂掉就没有任何退路。"""
    ad = _FakeAdapter({GPT: [_ok()]})          # FLASH 一律失败
    reset = bind_call_context(start_from_model=FLASH)
    try:
        assert _gw(ad).gen_image("p", []).startswith(b"\x89PNG")
    finally:
        reset()
    assert ad.seen[0] == FLASH, f"没有从指定的型号起跑:{ad.seen}"
    assert ad.seen[-1] == GPT, f"链尾型号失败后没有轮转回链首:{ad.seen}"


def test_starting_at_the_first_model_keeps_the_original_order():
    ad = _FakeAdapter({GPT: [_ok()]})
    reset = bind_call_context(start_from_model=GPT)
    try:
        _gw(ad).gen_image("p", [])
    finally:
        reset()
    assert ad.seen == [GPT]


# ── 贯通:出图循环真的按分配表发请求 ────────────────────────────────────────

def test_three_candidates_actually_call_two_different_models(monkeypatch):
    """从 ImageTaskExecutor 的出图段进,数网关实际收到的起始型号。"""
    from windup_app.server.orchestrator import executor as ex
    from windup_framework.gateway.context import current_call_context

    seen: list[str | None] = []

    import io as _io

    from PIL import Image

    def _png() -> bytes:
        """要真能被 PIL 打开:_produce_image 会解码它,假头会在解码那步就炸,
        测不到型号铺开这件事。"""
        im = Image.new("RGBA", (64, 96), (0, 0, 0, 0))
        im.paste((200, 60, 60, 255), (16, 8, 48, 88))
        buf = _io.BytesIO()
        im.save(buf, "PNG")
        return buf.getvalue()

    class _Gen:
        def gen_image(self, prompt, refs):
            seen.append(current_call_context().start_from_model)
            return _png()

    class _Matte:
        def cutout(self, png):
            return png

    e = ex.ImageTaskExecutor(image=_Gen(), matte=_Matte(),
                             upload=lambda png: "https://cdn.example.com/a.png")
    inp = ex.CharacterImageInput(prompt="一个剑客", num_images=3)
    e._produce_image(inp, ex.ProjectConstraints(sprite_w=64, sprite_h=96))

    assert len(seen) == 3, f"应发三次付费调用,实际 {len(seen)}"
    assert seen.count(GPT) == 2 and seen.count(FLASH) == 1, (
        f"三张候选没有跨型号铺开,实际 {seen}"
    )


def test_candidate_output_does_not_leak_which_model_made_it():
    """型号留在服务端。前端看得见型号,用户的选择就带上品牌先验,那次挑选也就不再是盲选。"""
    from dataclasses import fields

    from windup_app.server.orchestrator.model import CharacterImageOutput

    names = {f.name for f in fields(CharacterImageOutput)}
    assert not {n for n in names if "model" in n}, f"出参里出现了型号字段:{names}"
