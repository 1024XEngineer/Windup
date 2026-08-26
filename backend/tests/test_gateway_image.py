import json
import logging

import pytest
from windup_common.enums.model import ModelErrorType
from windup_framework.config.provider import AIProviderSettings
from windup_framework.gateway.circuit import CircuitBreaker
from windup_framework.gateway.image import ImageGateway
from windup_framework.gateway.registry import ModelRegistry
from windup_framework.gateway.types import AdapterResult

UNREACHED = AdapterResult(ok=False, error_type=ModelErrorType.UNREACHED, http_status=522)
BILLED = AdapterResult(ok=False, error_type=ModelErrorType.MAYBE_BILLED, http_status=520)
PNG = AdapterResult(ok=True, body=b"\x89PNG\r\n" + b"x" * 5000)


class FakeImageAdapter:
    def __init__(self, by_model: dict[str, list[AdapterResult]]):
        self.by_model = {k: list(v) for k, v in by_model.items()}
        self.calls: list[str] = []

    def submit_image(self, prompt, refs, model):
        self.calls.append(model)
        q = self.by_model[model]
        return q.pop(0) if q else AdapterResult(ok=False, error_type=ModelErrorType.UNKNOWN)


def _make_gw(adapter, **kw):
    circuit = kw.pop("circuit", None)
    cfg = AIProviderSettings(
        image_model="gemini-2.5-flash-image",
        image_fallbacks=kw.pop("image_fallbacks", ""),
        **kw,
    )
    registry = ModelRegistry.from_settings(cfg)
    return ImageGateway(registry, adapter, circuit or CircuitBreaker(), cfg)


def test_522_retries_same_model_once_and_does_not_fallback():
    ad = FakeImageAdapter({
        "gemini-2.5-flash-image": [UNREACHED, UNREACHED],
        "gemini-2.5-flash-image-alt": [PNG],
    })
    gw = _make_gw(ad, image_fallbacks="gemini-2.5-flash-image-alt")
    with pytest.raises(RuntimeError, match="522"):
        gw.gen_image("p", [])
    assert ad.calls == ["gemini-2.5-flash-image", "gemini-2.5-flash-image"]


def test_522_switches_base_url_route_before_model_fallback(caplog):
    caplog.set_level(logging.INFO, logger="windup.gateway")
    primary = FakeImageAdapter({
        "gemini-2.5-flash-image": [UNREACHED, UNREACHED],
        "gemini-2.5-flash-image-alt": [PNG],
    })
    backup = FakeImageAdapter({"gemini-2.5-flash-image": [PNG]})
    cfg = AIProviderSettings(
        image_model="gemini-2.5-flash-image",
        image_fallbacks="gemini-2.5-flash-image-alt",
        route_primary_name="primary",
        route_primary_base_url="https://api.qnaigc.com/v1",
        route_primary_api_key="primary-key",
        route_fallback_name="backup",
        route_fallback_base_url="https://backup.example.com/v1",
        route_fallback_api_key="backup-key",
    )
    gw = ImageGateway(
        ModelRegistry.from_settings(cfg),
        primary,
        CircuitBreaker(),
        cfg,
        route_adapters={"primary": primary, "backup": backup},
    )

    assert gw.gen_image("p", []).startswith(b"\x89PNG")
    assert primary.calls == ["gemini-2.5-flash-image", "gemini-2.5-flash-image"]
    assert backup.calls == ["gemini-2.5-flash-image"]
    assert "gemini-2.5-flash-image-alt" not in primary.calls

    records = [json.loads(r.message) for r in caplog.records if r.name == "windup.gateway"]
    success = [r for r in records if r.get("outcome") in ("success", "fallback_success")]
    assert success, caplog.text
    line = success[-1]
    assert line["route_reason"] == "base_url_unreached"
    assert line["route_layer"] == "base_url"
    assert line["base_url_id"] == "backup"


def test_aggregator_circuit_skips_fallback_model():
    ad = FakeImageAdapter({
        "gemini-2.5-flash-image": [UNREACHED, UNREACHED],
        "gemini-2.5-flash-image-alt": [PNG],
    })
    br = CircuitBreaker(cooldown_s=60)
    gw = _make_gw(ad, image_fallbacks="gemini-2.5-flash-image-alt", circuit=br)
    with pytest.raises(RuntimeError):
        gw.gen_image("p", [])
    assert "gemini-2.5-flash-image-alt" not in ad.calls
    assert br.is_open("aggregator")


def test_429_does_not_switch_model_when_only_one_key(monkeypatch):
    monkeypatch.setattr("windup_framework.gateway.image.time.sleep", lambda _: None)
    rate = AdapterResult(ok=False, error_type=ModelErrorType.RATE_LIMIT, http_status=429)
    ad = FakeImageAdapter({
        "gemini-2.5-flash-image": [rate, rate, rate],
        "gemini-2.5-flash-image-alt": [PNG],
    })
    gw = _make_gw(ad, image_fallbacks="gemini-2.5-flash-image-alt")
    with pytest.raises(RuntimeError, match="429"):
        gw.gen_image("p", [])
    assert ad.calls == ["gemini-2.5-flash-image"] * 3
    assert "gemini-2.5-flash-image-alt" not in ad.calls


def test_429_switches_key_on_same_base_url_before_model(monkeypatch, caplog):
    monkeypatch.setattr("windup_framework.gateway.image.time.sleep", lambda _: None)
    caplog.set_level(logging.INFO, logger="windup.gateway")
    rate = AdapterResult(ok=False, error_type=ModelErrorType.RATE_LIMIT, http_status=429)
    key_a = FakeImageAdapter({
        "gemini-2.5-flash-image": [rate, rate, rate],
        "gemini-2.5-flash-image-alt": [PNG],
    })
    key_b = FakeImageAdapter({"gemini-2.5-flash-image": [PNG]})
    cfg = AIProviderSettings(
        image_model="gemini-2.5-flash-image",
        image_fallbacks="gemini-2.5-flash-image-alt",
        route_primary_name="primary",
        route_primary_base_url="https://api.qnaigc.com/v1",
        route_primary_api_key="key-a",
        route_primary_api_keys="key-b",
    )
    gw = ImageGateway(
        ModelRegistry.from_settings(cfg),
        key_a,
        CircuitBreaker(),
        cfg,
        route_adapters={"primary.key0": key_a, "primary.key1": key_b},
    )

    assert gw.gen_image("p", []).startswith(b"\x89PNG")
    assert key_a.calls == ["gemini-2.5-flash-image"] * 3
    assert key_b.calls == ["gemini-2.5-flash-image"]
    assert "gemini-2.5-flash-image-alt" not in key_a.calls

    records = [json.loads(r.message) for r in caplog.records if r.name == "windup.gateway"]
    success = [r for r in records if r.get("outcome") in ("success", "fallback_success")]
    assert success, caplog.text
    line = success[-1]
    assert line["route_reason"] == "key_rate_limit"
    assert line["route_layer"] == "key"
    assert line["base_url_id"] == "primary"
    assert line["api_key_id"].endswith("key1")


def test_522_skips_remaining_keys_on_same_url(caplog):
    caplog.set_level(logging.INFO, logger="windup.gateway")
    key_a = FakeImageAdapter({
        "gemini-2.5-flash-image": [UNREACHED, UNREACHED],
        "gemini-2.5-flash-image-alt": [PNG],
    })
    key_b = FakeImageAdapter({"gemini-2.5-flash-image": [PNG]})
    backup = FakeImageAdapter({"gemini-2.5-flash-image": [PNG]})
    cfg = AIProviderSettings(
        image_model="gemini-2.5-flash-image",
        image_fallbacks="gemini-2.5-flash-image-alt",
        route_primary_name="primary",
        route_primary_base_url="https://api.qnaigc.com/v1",
        route_primary_api_key="key-a",
        route_primary_api_keys="key-b",
        route_fallback_name="backup",
        route_fallback_base_url="https://backup.example.com/v1",
        route_fallback_api_key="key-c",
    )
    gw = ImageGateway(
        ModelRegistry.from_settings(cfg),
        key_a,
        CircuitBreaker(),
        cfg,
        route_adapters={"primary.key0": key_a, "primary.key1": key_b, "backup.key0": backup},
    )

    assert gw.gen_image("p", []).startswith(b"\x89PNG")
    assert key_a.calls == ["gemini-2.5-flash-image", "gemini-2.5-flash-image"]
    assert key_b.calls == []
    assert backup.calls == ["gemini-2.5-flash-image"]


def test_520_does_not_retry():
    ad = FakeImageAdapter({"gemini-2.5-flash-image": [BILLED, PNG]})
    gw = _make_gw(ad, image_fallbacks="")
    with pytest.raises(RuntimeError, match="520"):
        gw.gen_image("p", [])
    assert ad.calls == ["gemini-2.5-flash-image"]


def test_empty_image_then_fallback():
    empty = AdapterResult(ok=False, error_type=ModelErrorType.INVALID_RESPONSE)
    ad = FakeImageAdapter({
        "gemini-2.5-flash-image": [empty, empty, empty],
        "gemini-2.5-flash-image-alt": [PNG],
    })
    gw = _make_gw(ad, image_fallbacks="gemini-2.5-flash-image-alt")
    gw.gen_image("p", [])
    assert ad.calls.count("gemini-2.5-flash-image") == 3
    assert ad.calls[-1] == "gemini-2.5-flash-image-alt"


def test_success_trace_prices_by_model_when_cost_not_configured(caplog):
    """没配 image_unit_cost 时按型号查牌价,而不是留空。

    留空在单型号时无害,跨型号之后就不是了:主备单价能差一倍,成本记不上的方向随兜底
    是否触发而变,事后无法回补。牌价单位是美元,与 ledger 给非空 cost 打的
    ``cost_currency="USD"`` 对齐。
    """
    caplog.set_level(logging.INFO, logger="windup.gateway")
    ad = FakeImageAdapter({"gemini-2.5-flash-image": [PNG]})
    gw = _make_gw(ad, image_fallbacks="")
    gw.gen_image("p", [])
    assert "total_latency_ms" in caplog.text
    assert '"cost": 0.0387' in caplog.text or '"cost":0.0387' in caplog.text


def test_explicit_unit_cost_overrides_the_model_price_table(caplog):
    caplog.set_level(logging.INFO, logger="windup.gateway")
    ad = FakeImageAdapter({"gemini-2.5-flash-image": [PNG]})
    gw = _make_gw(ad, image_fallbacks="", image_unit_cost=0.5)
    gw.gen_image("p", [])
    assert '"cost": 0.5' in caplog.text or '"cost":0.5' in caplog.text


def test_skip_open_model_circuit_sets_fallback_used(caplog):
    caplog.set_level(logging.INFO, logger="windup.gateway")
    ad = FakeImageAdapter({
        "gemini-2.5-flash-image": [PNG],
        "gemini-2.5-flash-image-alt": [PNG],
    })
    br = CircuitBreaker(cooldown_s=60)
    br.open("model:gemini-2.5-flash-image")
    gw = _make_gw(ad, image_fallbacks="gemini-2.5-flash-image-alt", circuit=br)
    assert gw.gen_image("p", []).startswith(b"\x89PNG")
    assert ad.calls == ["gemini-2.5-flash-image-alt"]
    records = [json.loads(r.message) for r in caplog.records if r.name == "windup.gateway"]
    success = [r for r in records if r.get("outcome") in ("success", "fallback_success")]
    assert success, caplog.text
    line = success[-1]
    assert line["fallback_used"] is True
    assert line["outcome"] == "fallback_success"
    assert line["route_reason"] == "skip_circuit_open"
    assert not any(
        r.get("outcome") == "success" and r.get("fallback_used") is False
        for r in records
    )
