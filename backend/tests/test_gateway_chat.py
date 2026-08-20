import asyncio
import json
import logging

import httpx
import pytest

from windup_common.enums.model import ModelErrorType
from windup_framework.config.provider import AIProviderSettings
from windup_framework.gateway.chat import (
    ChatAdapterResult,
    ChatGateway,
    LangChainChatAdapter,
)
from windup_framework.gateway.circuit import CircuitBreaker
from windup_framework.gateway.routes import key_circuit_id, routes_from_settings
from windup_framework.gateway.types import Scene
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
    cfg = AIProviderSettings(api_key="test-key", model="gpt-4o-mini")
    chat = create_chat_model(config=cfg)

    assert hasattr(chat, "invoke")
    assert hasattr(chat, "astream")
    assert hasattr(chat, "bind_tools")
    assert chat.__class__.__name__ == "ChatGateway"


def _primary_cfg(**kwargs) -> AIProviderSettings:
    base = dict(
        chat_model="gpt-4o-mini",
        api_key="k",
        route_primary_name="primary",
        route_primary_base_url="https://api.qnaigc.com/v1",
        route_primary_api_key="primary-key",
    )
    base.update(kwargs)
    return AIProviderSettings(**base)


def test_chat_requires_chat_model():
    gw = ChatGateway(
        adapter=FakeChatAdapter({}),
        circuit=CircuitBreaker(),
        settings=_primary_cfg(chat_model="", model=""),
    )
    with pytest.raises(RuntimeError, match="AI_CHAT_MODEL"):
        gw.invoke([{"role": "user", "content": "ping"}])


def test_chat_skips_when_aggregator_circuit_is_open(caplog):
    caplog.set_level(logging.INFO, logger="windup.gateway")
    adapter = FakeChatAdapter({"gpt-4o-mini": [OK]})
    circuit = CircuitBreaker()
    circuit.open("aggregator")
    gw = ChatGateway(adapter=adapter, circuit=circuit, settings=_primary_cfg())
    with pytest.raises(RuntimeError, match="chat gateway failed"):
        gw.invoke([{"role": "user", "content": "ping"}])
    assert adapter.calls == []
    records = [json.loads(r.message) for r in caplog.records if r.name == "windup.gateway"]
    assert records[-1]["route_reason"] == "skip_circuit_open"
    assert records[-1]["circuit_scope"] == "aggregator"


def test_chat_skips_open_base_url_to_backup():
    primary = FakeChatAdapter({"gpt-4o-mini": [OK]})
    backup = FakeChatAdapter({"gpt-4o-mini": [OK]})
    cfg = _primary_cfg(
        route_fallback_name="backup",
        route_fallback_base_url="https://backup.example.com/v1",
        route_fallback_api_key="backup-key",
    )
    circuit = CircuitBreaker()
    circuit.open("base_url:primary")
    gw = ChatGateway(
        adapter=primary,
        circuit=circuit,
        settings=cfg,
        route_adapters={"primary": primary, "backup": backup},
    )
    assert gw.invoke([{"role": "user", "content": "ping"}]) == "pong"
    assert primary.calls == []
    assert backup.calls == ["gpt-4o-mini"]


def test_chat_fails_when_last_base_url_circuit_is_open():
    adapter = FakeChatAdapter({"gpt-4o-mini": [OK]})
    circuit = CircuitBreaker()
    circuit.open("base_url:primary")
    gw = ChatGateway(adapter=adapter, circuit=circuit, settings=_primary_cfg())
    with pytest.raises(RuntimeError, match="chat gateway failed"):
        gw.invoke([{"role": "user", "content": "ping"}])
    assert adapter.calls == []


def test_chat_skips_open_key_circuit_to_next_key():
    key_a = FakeChatAdapter({"gpt-4o-mini": [OK]})
    key_b = FakeChatAdapter({"gpt-4o-mini": [OK]})
    cfg = _primary_cfg(route_primary_api_keys="key-b")
    routes = routes_from_settings(cfg, route_group=Scene.CHAT.value)
    circuit = CircuitBreaker()
    circuit.open(key_circuit_id(routes[0]))
    gw = ChatGateway(
        adapter=key_a,
        circuit=circuit,
        settings=cfg,
        route_adapters={"primary.key0": key_a, "primary.key1": key_b},
    )
    assert gw.invoke([{"role": "user", "content": "ping"}]) == "pong"
    assert key_a.calls == []
    assert key_b.calls == ["gpt-4o-mini"]


def test_chat_falls_back_to_next_model_after_invalid_response():
    bad = ChatAdapterResult(ok=False, error_type=ModelErrorType.INVALID_RESPONSE)
    adapter = FakeChatAdapter({
        "gpt-4o-mini": [bad, bad, bad],
        "gpt-4o-mini-alt": [OK],
    })
    gw = ChatGateway(
        adapter=adapter,
        circuit=CircuitBreaker(),
        settings=_primary_cfg(chat_fallbacks="gpt-4o-mini-alt"),
    )
    assert gw.invoke([{"role": "user", "content": "ping"}]) == "pong"
    assert adapter.calls == ["gpt-4o-mini"] * 3 + ["gpt-4o-mini-alt"]


def test_chat_auth_error_fails_without_fallback():
    auth = ChatAdapterResult(ok=False, error_type=ModelErrorType.AUTH, http_status=401)
    adapter = FakeChatAdapter({
        "gpt-4o-mini": [auth],
        "gpt-4o-mini-alt": [OK],
    })
    gw = ChatGateway(
        adapter=adapter,
        circuit=CircuitBreaker(),
        settings=_primary_cfg(chat_fallbacks="gpt-4o-mini-alt"),
    )
    with pytest.raises(RuntimeError, match="http_status=401"):
        gw.invoke([{"role": "user", "content": "ping"}])
    assert "gpt-4o-mini-alt" not in adapter.calls


def test_langchain_adapter_returns_ok(monkeypatch):
    class _Ok:
        def __init__(self, **kwargs):
            pass

        def invoke(self, messages, **kwargs):
            return "hi"

    monkeypatch.setattr("windup_framework.gateway.chat.ChatOpenAI", _Ok)
    r = LangChainChatAdapter(_primary_cfg()).invoke([], model="gpt-4o-mini")
    assert r.ok and r.value == "hi"


def test_langchain_adapter_maps_status_code(monkeypatch):
    class _Boom:
        def __init__(self, **kwargs):
            pass

        def invoke(self, messages, **kwargs):
            err = Exception("quota")
            err.status_code = 429
            raise err

    monkeypatch.setattr("windup_framework.gateway.chat.ChatOpenAI", _Boom)
    r = LangChainChatAdapter(_primary_cfg()).invoke([], model="gpt-4o-mini")
    assert not r.ok
    assert r.error_type is ModelErrorType.RATE_LIMIT
    assert r.http_status == 429


def test_langchain_adapter_maps_response_status(monkeypatch):
    class _Boom:
        def __init__(self, **kwargs):
            pass

        def invoke(self, messages, **kwargs):
            err = Exception("denied")
            err.response = httpx.Response(401, request=httpx.Request("POST", "https://x"))
            raise err

    monkeypatch.setattr("windup_framework.gateway.chat.ChatOpenAI", _Boom)
    r = LangChainChatAdapter(_primary_cfg()).invoke([], model="gpt-4o-mini")
    assert r.error_type is ModelErrorType.AUTH
    assert r.http_status == 401


def test_langchain_adapter_maps_connect_and_timeout(monkeypatch):
    req = httpx.Request("POST", "https://x")

    class _Connect:
        def __init__(self, **kwargs):
            pass

        def invoke(self, messages, **kwargs):
            raise httpx.ConnectError("down", request=req)

    monkeypatch.setattr("windup_framework.gateway.chat.ChatOpenAI", _Connect)
    r = LangChainChatAdapter(_primary_cfg()).invoke([], model="gpt-4o-mini")
    assert r.error_type is ModelErrorType.UNREACHED

    class _Timeout:
        def __init__(self, **kwargs):
            pass

        def invoke(self, messages, **kwargs):
            raise httpx.ReadTimeout("slow", request=req)

    monkeypatch.setattr("windup_framework.gateway.chat.ChatOpenAI", _Timeout)
    r = LangChainChatAdapter(_primary_cfg()).invoke([], model="gpt-4o-mini")
    assert r.error_type is ModelErrorType.TIMEOUT


def test_langchain_adapter_unknown_exception_stays_unknown(monkeypatch):
    class _Boom:
        def __init__(self, **kwargs):
            pass

        def invoke(self, messages, **kwargs):
            raise ValueError("weird")

    monkeypatch.setattr("windup_framework.gateway.chat.ChatOpenAI", _Boom)
    r = LangChainChatAdapter(_primary_cfg()).invoke([], model="gpt-4o-mini")
    assert r.error_type is ModelErrorType.UNKNOWN


class _StreamAdapter:
    def __init__(self, chunks):
        self.chunks = list(chunks)
        self.tools = None
        self.calls: list[str] = []

    def bind_tools(self, tools):
        bound = _StreamAdapter(self.chunks)
        bound.tools = tools
        return bound

    async def astream(self, messages, *, model: str, **kwargs):
        self.calls.append(model)
        for chunk in self.chunks:
            if isinstance(chunk, ChatAdapterResult):
                yield chunk
            else:
                yield ChatAdapterResult(ok=True, value=chunk)


def test_chat_gateway_bind_tools_keeps_model_name():
    adapter = _StreamAdapter(["hi"])
    gw = ChatGateway(
        adapter=adapter,
        circuit=CircuitBreaker(),
        settings=_primary_cfg(),
        route_adapters={"primary": adapter},
    )
    bound = gw.bind_tools([{"type": "function", "function": {"name": "lookup"}}])
    assert bound.model_name == "gpt-4o-mini"
    assert bound._adapter.tools[0]["function"]["name"] == "lookup"


def test_chat_gateway_astream_yields_chunks_and_skips_open_route():
    down = _StreamAdapter([UNREACHED])
    up = _StreamAdapter(["你", "好"])
    cfg = _primary_cfg(
        route_fallback_name="backup",
        route_fallback_base_url="https://backup.example.com/v1",
        route_fallback_api_key="backup-key",
    )
    circuit = CircuitBreaker()
    circuit.open("base_url:primary")
    gw = ChatGateway(
        adapter=down,
        circuit=circuit,
        settings=cfg,
        route_adapters={"primary": down, "backup": up},
    )

    async def _collect():
        return [chunk async for chunk in gw.astream([{"role": "user", "content": "ping"}])]

    chunks = asyncio.run(_collect())
    assert chunks == ["你", "好"]
    assert down.calls == []
    assert up.calls == ["gpt-4o-mini"]
