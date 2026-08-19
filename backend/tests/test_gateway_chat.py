import json
import logging

from windup_common.enums.model import ModelErrorType
from windup_framework.config.provider import AIProviderSettings
from windup_framework.gateway.chat import ChatAdapterResult, ChatGateway
from windup_framework.gateway.circuit import CircuitBreaker
from windup_framework.providers.chat import create_chat_model

UNREACHED = ChatAdapterResult(ok=False, error_type=ModelErrorType.UNREACHED, http_status=522)
OK = ChatAdapterResult(ok=True, value="pong")


class FakeChatAdapter:
    def __init__(self, by_model: dict[str, list[ChatAdapterResult]]):
        self.by_model = {k: list(v) for k, v in by_model.items()}
        self.calls: list[str] = []

    def invoke(self, messages, *, model: str, **kwargs):
        self.calls.append(model)
        q = self.by_model[model]
        return q.pop(0) if q else ChatAdapterResult(ok=False, error_type=ModelErrorType.UNKNOWN)


def test_chat_gateway_switches_base_url_route_after_unreached(caplog):
    caplog.set_level(logging.INFO, logger="windup.gateway")
    primary = FakeChatAdapter({"gpt-4o-mini": [UNREACHED, UNREACHED]})
    backup = FakeChatAdapter({"gpt-4o-mini": [OK]})
    cfg = AIProviderSettings(
        model="gpt-4o-mini",
        route_primary_name="primary",
        route_primary_base_url="https://api.qnaigc.com/v1",
        route_primary_api_key="primary-key",
        route_fallback_name="backup",
        route_fallback_base_url="https://backup.example.com/v1",
        route_fallback_api_key="backup-key",
    )
    gw = ChatGateway(
        adapter=primary,
        circuit=CircuitBreaker(),
        settings=cfg,
        route_adapters={"primary": primary, "backup": backup},
    )

    assert gw.invoke([{"role": "user", "content": "ping"}]) == "pong"
    assert primary.calls == ["gpt-4o-mini", "gpt-4o-mini"]
    assert backup.calls == ["gpt-4o-mini"]

    records = [json.loads(r.message) for r in caplog.records if r.name == "windup.gateway"]
    success = [r for r in records if r.get("outcome") in ("success", "fallback_success")]
    assert success, caplog.text
    line = success[-1]
    assert line["scene"] == "chat"
    assert line["family"] == "chat.completions"
    assert line["route_reason"] == "base_url_unreached"
    assert line["route_layer"] == "base_url"
    assert line["base_url_id"] == "backup"


def test_chat_gateway_switches_key_after_429(monkeypatch, caplog):
    monkeypatch.setattr("windup_framework.gateway.chat.time.sleep", lambda _: None)
    caplog.set_level(logging.INFO, logger="windup.gateway")
    rate = ChatAdapterResult(ok=False, error_type=ModelErrorType.RATE_LIMIT, http_status=429)
    key_a = FakeChatAdapter({"gpt-4o-mini": [rate, rate, rate]})
    key_b = FakeChatAdapter({"gpt-4o-mini": [OK]})
    cfg = AIProviderSettings(
        model="gpt-4o-mini",
        route_primary_name="primary",
        route_primary_base_url="https://api.qnaigc.com/v1",
        route_primary_api_key="key-a",
        route_primary_api_keys="key-b",
    )
    gw = ChatGateway(
        adapter=key_a,
        circuit=CircuitBreaker(),
        settings=cfg,
        route_adapters={"primary.key0": key_a, "primary.key1": key_b},
    )

    assert gw.invoke([{"role": "user", "content": "ping"}]) == "pong"
    assert key_a.calls == ["gpt-4o-mini"] * 3
    assert key_b.calls == ["gpt-4o-mini"]
    records = [json.loads(r.message) for r in caplog.records if r.name == "windup.gateway"]
    success = [r for r in records if r.get("outcome") in ("success", "fallback_success")]
    line = success[-1]
    assert line["route_reason"] == "key_rate_limit"
    assert line["route_layer"] == "key"


def test_create_chat_model_returns_gateway_without_hand_rolling_protocol():
    cfg = AIProviderSettings(model="gpt-4o-mini")
    chat = create_chat_model(config=cfg)

    assert hasattr(chat, "invoke")
    assert chat.__class__.__name__ == "ChatGateway"
