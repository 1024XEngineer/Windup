"""POST /ai/chat：无状态 LLM 代理，流式转发 ``create_chat_model``。"""

from __future__ import annotations

import json
from types import SimpleNamespace
from unittest.mock import patch

from langchain_core.messages import (
    AIMessage,
    AIMessageChunk,
    HumanMessage,
    SystemMessage,
    ToolMessage,
)
from openai.types.chat import ChatCompletionChunk

from windup_app.web.api.agent import _openai_tool_calls_to_lc, _tool_call_chunk_to_openai
from windup_common.enums.biz_code import BizCode


def _payload(**overrides) -> dict:
    body = {"messages": [{"role": "user", "content": "你好"}]}
    body.update(overrides)
    return body


def _parse_sse(text: str) -> list[dict | str]:
    events: list[dict | str] = []
    for line in text.splitlines():
        if not line.startswith("data: "):
            continue
        payload = line[len("data: ") :]
        if payload == "[DONE]":
            events.append("[DONE]")
            continue
        events.append(json.loads(payload))
    return events


def _delta_contents(events: list[dict | str]) -> list[str]:
    contents: list[str] = []
    for event in events:
        if not isinstance(event, dict):
            continue
        choices = event.get("choices") or []
        if not choices:
            continue
        content = (choices[0].get("delta") or {}).get("content")
        if content:
            contents.append(content)
    return contents


class _FakeChatModel:
    """只实现代理会用到的 ``astream`` / ``bind_tools``。"""

    def __init__(self, chunks: list[AIMessageChunk]):
        self._chunks = chunks
        self.bound_tools = None
        self.seen_messages = None
        self.model_name = "fake-model"

    def bind_tools(self, tools):
        self.bound_tools = tools
        return self

    async def astream(self, messages):
        self.seen_messages = messages
        for chunk in self._chunks:
            yield chunk


def test_chat_requires_auth(client):
    response = client.post("/ai/chat", json=_payload())

    assert response.status_code == 200
    assert response.json()["code"] == BizCode.UNAUTHORIZED


def test_chat_streams_openai_sse_content(auth_client):
    fake = _FakeChatModel(
        [
            AIMessageChunk(content="你"),
            AIMessageChunk(content="好"),
        ]
    )

    with patch(
        "windup_app.web.api.agent.create_chat_model",
        return_value=fake,
    ):
        response = auth_client.post("/ai/chat", json=_payload())

    assert response.status_code == 200
    assert "text/event-stream" in response.headers["content-type"]
    events = _parse_sse(response.text)
    assert _delta_contents(events) == ["你", "好"]
    assert events[-1] == "[DONE]"
    chunks = [event for event in events if isinstance(event, dict) and "choices" in event]
    assert chunks
    for chunk in chunks:
        ChatCompletionChunk.model_validate(chunk)
        assert chunk["object"] == "chat.completion.chunk"
        assert chunk["model"] == "fake-model"
        assert chunk["choices"][0]["index"] == 0
    assert {chunk["id"] for chunk in chunks} == {chunks[0]["id"]}
    assert fake.seen_messages is not None
    assert isinstance(fake.seen_messages[0], HumanMessage)
    assert fake.seen_messages[0].content == "你好"


def test_chat_prepends_system_and_preserves_history(auth_client):
    fake = _FakeChatModel([AIMessageChunk(content="ok")])
    body = _payload(
        system="你是助手",
        messages=[
            {"role": "user", "content": "上一句"},
            {
                "role": "assistant",
                "content": None,
                "tool_calls": [
                    {
                        "id": "call_1",
                        "type": "function",
                        "function": {
                            "name": "lookup",
                            "arguments": '{"q":"风"}',
                        },
                    }
                ],
            },
            {
                "role": "tool",
                "content": "结果",
                "tool_call_id": "call_1",
            },
            {"role": "user", "content": "继续"},
        ],
    )

    with patch(
        "windup_app.web.api.agent.create_chat_model",
        return_value=fake,
    ):
        response = auth_client.post("/ai/chat", json=body)

    assert response.status_code == 200
    messages = fake.seen_messages
    assert isinstance(messages[0], SystemMessage)
    assert messages[0].content == "你是助手"
    assert isinstance(messages[1], HumanMessage)
    assert isinstance(messages[2], AIMessage)
    assert messages[2].tool_calls[0]["name"] == "lookup"
    assert messages[2].tool_calls[0]["args"] == {"q": "风"}
    assert isinstance(messages[3], ToolMessage)
    assert messages[3].tool_call_id == "call_1"
    assert isinstance(messages[4], HumanMessage)
    assert messages[4].content == "继续"


def test_chat_passes_model_temperature_and_tools(auth_client):
    fake = _FakeChatModel([AIMessageChunk(content="ok")])
    captured: dict = {}

    def _factory(config=None, **kwargs):
        captured["config"] = config
        captured["kwargs"] = kwargs
        return fake

    tools = [
        {
            "type": "function",
            "function": {
                "name": "lookup",
                "description": "查询",
                "parameters": {"type": "object", "properties": {}},
            },
        }
    ]

    with patch(
        "windup_app.web.api.agent.create_chat_model",
        side_effect=_factory,
    ):
        response = auth_client.post(
            "/ai/chat",
            json=_payload(model="gpt-4o", temperature=0.2, tools=tools),
        )

    assert response.status_code == 200
    assert captured["config"].chat_model == "gpt-4o"
    assert captured["kwargs"]["temperature"] == 0.2
    assert fake.bound_tools is not None
    assert fake.bound_tools[0]["function"]["name"] == "lookup"


def test_chat_streams_tool_call_deltas(auth_client):
    fake = _FakeChatModel(
        [
            AIMessageChunk(
                content="",
                tool_call_chunks=[
                    {
                        "index": 0,
                        "id": "call_1",
                        "name": "lookup",
                        "args": '{"q":',
                    }
                ],
            )
        ]
    )

    with patch(
        "windup_app.web.api.agent.create_chat_model",
        return_value=fake,
    ):
        response = auth_client.post("/ai/chat", json=_payload())

    events = _parse_sse(response.text)
    tool_events = [
        event
        for event in events
        if isinstance(event, dict) and (event.get("choices") or [{}])[0].get("delta", {}).get("tool_calls")
    ]
    assert tool_events
    tool_call = tool_events[0]["choices"][0]["delta"]["tool_calls"][0]
    assert tool_call["id"] == "call_1"
    assert tool_call["function"]["name"] == "lookup"
    assert tool_call["function"]["arguments"] == '{"q":'
    ChatCompletionChunk.model_validate(tool_events[0])


def test_chat_missing_api_key_returns_model_unavailable(auth_client):
    with patch(
        "windup_app.web.api.agent.create_chat_model",
        side_effect=ValueError("AI_API_KEY 未配置"),
    ):
        response = auth_client.post("/ai/chat", json=_payload())

    assert response.status_code == 200
    body = response.json()
    assert body["code"] == BizCode.MODEL_UNAVAILABLE
    assert "AI_API_KEY" in body["message"]


def test_chat_malformed_tools_returns_bad_request(auth_client):
    class _BadBind:
        def bind_tools(self, tools):
            raise KeyError("name")

    with patch(
        "windup_app.web.api.agent.create_chat_model",
        return_value=_BadBind(),
    ):
        response = auth_client.post(
            "/ai/chat",
            json=_payload(
                tools=[
                    {
                        "type": "function",
                        "function": {"description": "缺 name"},
                    }
                ]
            ),
        )

    assert response.status_code == 200
    assert response.json()["code"] == BizCode.BAD_REQUEST


def test_chat_invalid_tool_call_arguments_returns_bad_request(auth_client):
    fake = _FakeChatModel([AIMessageChunk(content="ok")])
    with patch(
        "windup_app.web.api.agent.create_chat_model",
        return_value=fake,
    ):
        response = auth_client.post(
            "/ai/chat",
            json=_payload(
                messages=[
                    {
                        "role": "assistant",
                        "tool_calls": [
                            {
                                "id": "call_1",
                                "type": "function",
                                "function": {
                                    "name": "lookup",
                                    "arguments": "{not-json",
                                },
                            }
                        ],
                    }
                ]
            ),
        )

    assert response.status_code == 200
    assert response.json()["code"] == BizCode.BAD_REQUEST
    assert fake.seen_messages is None


def test_chat_upstream_error_does_not_send_done(auth_client):
    class _Boom:
        async def astream(self, messages):
            if False:
                yield None
            raise RuntimeError("upstream down")

    with patch(
        "windup_app.web.api.agent.create_chat_model",
        return_value=_Boom(),
    ):
        response = auth_client.post("/ai/chat", json=_payload())

    events = _parse_sse(response.text)
    assert any(isinstance(event, dict) and "error" in event for event in events)
    assert "[DONE]" not in events


def test_chat_keeps_system_role_messages_and_skips_empty_chunks(auth_client):
    fake = _FakeChatModel(
        [
            AIMessageChunk(content=""),
            AIMessageChunk(content="ok"),
        ]
    )
    with patch(
        "windup_app.web.api.agent.create_chat_model",
        return_value=fake,
    ):
        response = auth_client.post(
            "/ai/chat",
            json=_payload(
                messages=[
                    {"role": "system", "content": "只说 ok"},
                    {"role": "user", "content": "你好"},
                ]
            ),
        )

    assert response.status_code == 200
    assert _delta_contents(_parse_sse(response.text)) == ["ok"]
    assert isinstance(fake.seen_messages[0], SystemMessage)
    assert fake.seen_messages[0].content == "只说 ok"


def test_chat_tool_call_arguments_as_object(auth_client):
    fake = _FakeChatModel([AIMessageChunk(content="ok")])
    with patch(
        "windup_app.web.api.agent.create_chat_model",
        return_value=fake,
    ):
        response = auth_client.post(
            "/ai/chat",
            json=_payload(
                messages=[
                    {
                        "role": "assistant",
                        "tool_calls": [
                            {
                                "id": "call_1",
                                "type": "function",
                                "function": {
                                    "name": "lookup",
                                    "arguments": {"q": "风"},
                                },
                            }
                        ],
                    }
                ]
            ),
        )

    assert response.status_code == 200
    assert fake.seen_messages[0].tool_calls[0]["args"] == {"q": "风"}


def test_chat_tool_call_arguments_non_object_returns_bad_request(auth_client):
    fake = _FakeChatModel([AIMessageChunk(content="ok")])
    with patch(
        "windup_app.web.api.agent.create_chat_model",
        return_value=fake,
    ):
        response = auth_client.post(
            "/ai/chat",
            json=_payload(
                messages=[
                    {
                        "role": "assistant",
                        "tool_calls": [
                            {
                                "id": "call_1",
                                "type": "function",
                                "function": {
                                    "name": "lookup",
                                    "arguments": "[1]",
                                },
                            }
                        ],
                    }
                ]
            ),
        )

    assert response.json()["code"] == BizCode.BAD_REQUEST
    assert fake.seen_messages is None


def test_openai_tool_calls_empty_and_passthrough():
    assert _openai_tool_calls_to_lc(None) == []
    assert _openai_tool_calls_to_lc([]) == []
    assert _openai_tool_calls_to_lc([{"id": "call_1"}]) == [{"id": "call_1"}]


def test_openai_tool_calls_rejects_non_json_object_type():
    try:
        _openai_tool_calls_to_lc(
            [
                {
                    "id": "call_1",
                    "function": {"name": "lookup", "arguments": 1},
                }
            ]
        )
    except Exception as exc:
        assert getattr(exc, "code", None) == BizCode.BAD_REQUEST
    else:
        raise AssertionError("expected BizException")


def test_tool_call_chunk_from_object_serializes_args():
    chunk = SimpleNamespace(index=0, id="call_1", name="lookup", args={"q": "风"})
    out = _tool_call_chunk_to_openai(chunk)
    assert out["id"] == "call_1"
    assert out["function"]["name"] == "lookup"
    assert json.loads(out["function"]["arguments"]) == {"q": "风"}
