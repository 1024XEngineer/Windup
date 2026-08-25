"""``POST /ai/chat``: authenticated, bounded, stateless model proxy."""

from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import Callable
from functools import partial
from typing import Any

import httpx
import pytest

from windup_app.bootstrap.app import create_app
from windup_app.server.user.service import create_access_token
from windup_app.web.api import agent as agent_api
from windup_framework.config.provider import AIProviderSettings
from windup_framework.providers.chat import create_chat_model


OpenAIResponse = dict[str, Any] | tuple[int, dict[str, Any]]


@pytest.fixture()
def install_openai_provider(monkeypatch):
    """Put the real ChatOpenAI provider behind a deterministic HTTP transport."""
    clients: list[httpx.AsyncClient] = []

    def install(test_client, *responses: OpenAIResponse) -> list[dict[str, Any]]:
        pending = list(responses)
        requests: list[dict[str, Any]] = []

        def handle(request: httpx.Request) -> httpx.Response:
            requests.append(json.loads(request.content))
            response = pending.pop(0) if pending else responses[-1]
            status, payload = (
                response if isinstance(response, tuple) else (200, response)
            )
            return httpx.Response(status, json=payload)

        http_client = httpx.AsyncClient(transport=httpx.MockTransport(handle))
        clients.append(http_client)
        monkeypatch.setattr(
            agent_api,
            "provider_settings",
            AIProviderSettings(
                api_key="test-key",
                base_url="https://provider.test/v1",
                chat_model="server-model",
                model="",
                max_retries=3,
            ),
        )
        test_client.app.state.chat_model_factory = partial(
            create_chat_model,
            http_async_client=http_client,
        )
        return requests

    yield install

    for client in clients:
        asyncio.run(client.aclose())


def _text_completion() -> dict[str, Any]:
    return {
        "id": "chatcmpl-text",
        "object": "chat.completion",
        "created": 1,
        "model": "server-model",
        "choices": [
            {
                "index": 0,
                "message": {"role": "assistant", "content": "还需要角色的美术风格。"},
                "finish_reason": "stop",
            }
        ],
        "usage": {"prompt_tokens": 12, "completion_tokens": 8, "total_tokens": 20},
    }


def _tool_completion() -> dict[str, Any]:
    return {
        "id": "chatcmpl-tool",
        "object": "chat.completion",
        "created": 2,
        "model": "server-model",
        "choices": [
            {
                "index": 0,
                "message": {
                    "role": "assistant",
                    "content": None,
                    "tool_calls": [
                        {
                            "id": "call_start",
                            "type": "function",
                            "function": {
                                "name": "start_character_generation",
                                "arguments": json.dumps(
                                    {
                                        "optimizedPrompt": "银发像素骑士全身像",
                                        "assumptions": ["默认单角色"],
                                    },
                                    ensure_ascii=False,
                                ),
                            },
                        }
                    ],
                },
                "finish_reason": "tool_calls",
            }
        ],
        "usage": {"prompt_tokens": 18, "completion_tokens": 14, "total_tokens": 32},
    }


def _request_body(**overrides: Any) -> dict[str, Any]:
    body: dict[str, Any] = {
        "model": "client-must-not-select-this",
        "messages": [{"role": "user", "content": "直接生成银发像素骑士"}],
        "tools": [
            {
                "type": "function",
                "function": {
                    "name": "start_character_generation",
                    "description": "开始角色母版生成",
                    "strict": True,
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "optimizedPrompt": {"type": "string"},
                            "assumptions": {
                                "type": "array",
                                "items": {"type": "string"},
                            },
                        },
                        "required": ["optimizedPrompt", "assumptions"],
                    },
                },
            }
        ],
        "tool_choice": "auto",
        "stream": False,
        "max_tokens": 99_999,
    }
    body.update(overrides)
    return body


def test_ai_chat_is_mounted_with_openapi_contract(client):
    operation = client.get("/openapi.json").json()["paths"]["/ai/chat"]["post"]

    request_schema = operation["requestBody"]["content"]["application/json"]["schema"]
    success_schema = operation["responses"]["200"]["content"]["application/json"][
        "schema"
    ]
    validation_schema = operation["responses"]["422"]["content"]["application/json"][
        "schema"
    ]
    auth_schema = operation["responses"]["401"]["content"]["application/json"]["schema"]
    assert request_schema["$ref"].endswith("/ChatRequest")
    assert success_schema["$ref"].endswith("/ChatCompletionResponse")
    assert auth_schema["$ref"].endswith("/OpenAIErrorResponse")
    assert validation_schema["$ref"].endswith("/OpenAIErrorResponse")
    assert operation["security"] == [{"HTTPBearer": []}]


def test_ai_chat_requires_auth_before_calling_provider(client):
    calls = 0

    def forbidden_factory(*_args: Any, **_kwargs: Any):
        nonlocal calls
        calls += 1
        raise AssertionError("unauthenticated request reached the paid provider")

    client.app.state.chat_model_factory = forbidden_factory

    response = client.post("/ai/chat", json=_request_body())

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "authentication_error"
    assert calls == 0


def test_ai_chat_returns_text_from_real_provider(
    auth_client,
    install_openai_provider: Callable[..., list[dict[str, Any]]],
):
    provider_requests = install_openai_provider(auth_client, _text_completion())

    response = auth_client.post("/ai/chat", json=_request_body())

    assert response.status_code == 200
    payload = response.json()
    assert payload["id"] == "chatcmpl-text"
    assert payload["model"] == "server-model"
    assert payload["choices"] == [
        {
            "index": 0,
            "message": {
                "role": "assistant",
                "content": "还需要角色的美术风格。",
                "tool_calls": None,
            },
            "finish_reason": "stop",
        }
    ]
    assert payload["usage"] == {
        "prompt_tokens": 12,
        "completion_tokens": 8,
        "total_tokens": 20,
    }
    assert response.headers["x-request-id"]
    assert provider_requests[0]["model"] == "server-model"
    assert provider_requests[0]["max_completion_tokens"] == 1_024
    assert provider_requests[0]["stream"] is False
    assert provider_requests[0]["tools"][0]["function"]["strict"] is True
    assert "max_tokens" not in provider_requests[0]


def test_ai_chat_preserves_one_tool_call_from_real_provider(
    auth_client,
    install_openai_provider: Callable[..., list[dict[str, Any]]],
):
    install_openai_provider(auth_client, _tool_completion())

    response = auth_client.post("/ai/chat", json=_request_body())

    choice = response.json()["choices"][0]
    assert choice["finish_reason"] == "tool_calls"
    assert choice["message"]["content"] is None
    tool_call = choice["message"]["tool_calls"][0]
    assert tool_call["id"] == "call_start"
    assert tool_call["type"] == "function"
    assert tool_call["function"]["name"] == "start_character_generation"
    assert json.loads(tool_call["function"]["arguments"]) == {
        "optimizedPrompt": "银发像素骑士全身像",
        "assumptions": ["默认单角色"],
    }


def test_ai_chat_rejects_oversized_history_before_provider(auth_client):
    calls = 0

    def forbidden_factory(*_args: Any, **_kwargs: Any):
        nonlocal calls
        calls += 1
        raise AssertionError("invalid request reached the paid provider")

    auth_client.app.state.chat_model_factory = forbidden_factory
    messages = [{"role": "user", "content": f"message-{index}"} for index in range(17)]

    response = auth_client.post("/ai/chat", json=_request_body(messages=messages))

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "invalid_request"
    assert calls == 0


def test_ai_chat_rejects_oversized_body_before_provider(auth_client):
    calls = 0

    def forbidden_factory(*_args: Any, **_kwargs: Any):
        nonlocal calls
        calls += 1
        raise AssertionError("oversized request reached the paid provider")

    auth_client.app.state.chat_model_factory = forbidden_factory

    response = auth_client.post(
        "/ai/chat",
        json=_request_body(ignored_padding="x" * 66_000),
    )

    assert response.status_code == 413
    assert response.json()["error"]["code"] == "request_too_large"
    assert calls == 0


@pytest.fixture()
def anyio_backend():
    return "asyncio"


@pytest.mark.anyio
async def test_ai_chat_rejects_chunked_body_before_json_parse():
    async def chunks():
        yield b'{"messages":[{"role":"user","content":"'
        yield b"x" * 70_000
        yield b'"}]}'

    app = create_app()
    token = create_access_token(1, "test@example.com")
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(
        transport=transport,
        base_url="http://test",
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
    ) as async_client:
        response = await async_client.post("/ai/chat", content=chunks())

    assert response.status_code == 413
    assert response.json()["error"]["code"] == "request_too_large"


def test_ai_chat_reports_missing_configuration(auth_client, monkeypatch):
    monkeypatch.setattr(
        agent_api,
        "provider_settings",
        AIProviderSettings(api_key="", chat_model="server-model", model=""),
    )
    auth_client.app.state.chat_model_factory = create_chat_model

    response = auth_client.post("/ai/chat", json=_request_body())

    assert response.status_code == 503
    assert response.headers["x-request-id"]
    assert response.json()["error"] == {
        "message": "AI 服务未配置",
        "type": "service_unavailable",
        "code": "ai_not_configured",
    }


def test_ai_chat_does_not_retry_upstream_failures(
    auth_client,
    install_openai_provider: Callable[..., list[dict[str, Any]]],
    caplog,
):
    caplog.set_level(logging.INFO, logger="windup.ai.proxy")
    provider_requests = install_openai_provider(
        auth_client,
        (500, {"error": {"message": "provider unavailable"}}),
    )

    response = auth_client.post("/ai/chat", json=_request_body())

    assert response.status_code == 502
    request_id = response.headers["x-request-id"]
    assert request_id
    assert response.json()["error"] == {
        "message": "AI 服务暂时不可用",
        "type": "upstream_error",
        "code": "ai_upstream_error",
    }
    assert len(provider_requests) == 1
    assert any(
        "AI chat upstream failed" in record.message and request_id in record.message
        for record in caplog.records
        if record.name == "windup.ai.proxy"
    )


def test_ai_chat_binds_user_and_request_id_into_gateway_trace(
    auth_client,
    install_openai_provider: Callable[..., list[dict[str, Any]]],
    caplog,
):
    caplog.set_level(logging.INFO)
    install_openai_provider(auth_client, _text_completion())

    response = auth_client.post("/ai/chat", json=_request_body())

    request_id = response.headers["x-request-id"]
    assert response.status_code == 200
    proxy_logs = [r.message for r in caplog.records if r.name == "windup.ai.proxy"]
    assert any(f"AI chat started request_id={request_id} user_id=1" in msg for msg in proxy_logs)
    assert any(
        f"AI chat completed request_id={request_id} user_id=1" in msg
        and "finish_reason=stop" in msg
        for msg in proxy_logs
    )
    traces = [
        json.loads(r.message)
        for r in caplog.records
        if r.name == "windup.gateway" and r.message.startswith("{")
    ]
    assert traces
    assert traces[-1]["request_id"] == request_id
    assert traces[-1]["user_id"] == "1"
    assert traces[-1]["outcome"] == "success"


class _UnserializableChatResult:
    invalid_tool_calls = ["broken"]
    tool_calls = None
    content = "hi"
    response_metadata = {}
    usage_metadata = None
    id = "chatcmpl-bad"


def test_ai_chat_logs_serialize_failure_after_upstream_success(auth_client, caplog):
    caplog.set_level(logging.INFO, logger="windup.ai.proxy")

    class _Gateway:
        async def ainvoke(self, *_args: Any, **_kwargs: Any):
            return _UnserializableChatResult()

    auth_client.app.state.chat_model_factory = lambda *_args, **_kwargs: _Gateway()

    response = auth_client.post("/ai/chat", json=_request_body())

    assert response.status_code == 502
    request_id = response.headers["x-request-id"]
    assert any(
        "AI chat serialize failed" in record.message and request_id in record.message
        for record in caplog.records
        if record.name == "windup.ai.proxy"
    )
