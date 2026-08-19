"""AI Proxy（LLM 代理）API。

后端是无状态 LLM 代理，不做 agent 编排。
前端维护 conversation history，传完整 messages 数组。
OpenAI 兼容格式，前端可用 OpenAI SDK 解析。

端点
----
POST /ai/chat    LLM 代理（流式响应）

认证
----
复用现有 JWT 体系，user_id 从 token 解析（用于日志/审计，不存对话）。
"""

from __future__ import annotations

import json
import logging
from typing import Any

from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse
from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage, ToolMessage
from pydantic import BaseModel, Field

from windup_common.enums.biz_code import BizCode
from windup_common.exceptions import BizException
from windup_framework.config.provider import settings
from windup_framework.providers.chat import create_chat_model

logger = logging.getLogger("windup.ai.proxy")

router = APIRouter(prefix="/ai", tags=["ai"])


# ══════════════════════════════════════════════════════════════════════════════
# 请求/响应模型
# ══════════════════════════════════════════════════════════════════════════════


class ChatMessage(BaseModel):
    """对话消息。"""

    role: str = Field(description="消息角色：system / user / assistant / tool")
    content: str | None = Field(default=None, description="消息内容")
    tool_calls: list[dict] | None = Field(default=None, description="工具调用（assistant 角色）")
    tool_call_id: str | None = Field(default=None, description="工具结果关联的调用 ID（tool 角色）")


class ToolDefinition(BaseModel):
    """工具定义（OpenAI function calling 格式）。"""

    type: str = Field(default="function", description="工具类型，固定为 function")
    function: dict = Field(description="函数定义：{name, description, parameters}")


class ChatRequest(BaseModel):
    """LLM 代理请求。"""

    system: str | None = Field(default=None, description="系统提示词")
    messages: list[ChatMessage] = Field(description="对话历史（前端维护完整列表）")
    model: str | None = Field(default=None, description="模型名称，省略则使用默认模型")
    temperature: float | None = Field(default=None, ge=0, le=2, description="温度参数")
    tools: list[ToolDefinition] | None = Field(
        default=None,
        description="可用工具列表（前端定义，后端透传给 LLM）",
    )


# ══════════════════════════════════════════════════════════════════════════════
# 消息 / SSE 转换
# ══════════════════════════════════════════════════════════════════════════════


def _openai_tool_calls_to_lc(tool_calls: list[dict] | None) -> list[dict]:
    """把前端 OpenAI 格式 tool_calls 转成 LangChain ``AIMessage.tool_calls``。"""
    if not tool_calls:
        return []
    converted: list[dict] = []
    for call in tool_calls:
        function = call.get("function")
        if not isinstance(function, dict):
            converted.append(call)
            continue
        raw_args = function.get("arguments", "{}")
        if isinstance(raw_args, str):
            try:
                args = json.loads(raw_args) if raw_args else {}
            except json.JSONDecodeError as exc:
                raise BizException(
                    "tool_calls.arguments 不是合法 JSON",
                    code=BizCode.BAD_REQUEST,
                ) from exc
        elif isinstance(raw_args, dict):
            args = raw_args
        else:
            raise BizException(
                "tool_calls.arguments 必须是 JSON 对象",
                code=BizCode.BAD_REQUEST,
            )
        if not isinstance(args, dict):
            raise BizException(
                "tool_calls.arguments 必须是 JSON 对象",
                code=BizCode.BAD_REQUEST,
            )
        converted.append(
            {
                "name": function.get("name") or "",
                "args": args,
                "id": call.get("id") or "",
                "type": "tool_call",
            }
        )
    return converted


def _to_lc_messages(body: ChatRequest) -> list[BaseMessage]:
    """把请求体转成 ``create_chat_model().astream`` 需要的 LangChain 消息。"""
    messages: list[BaseMessage] = []
    if body.system:
        messages.append(SystemMessage(content=body.system))
    for item in body.messages:
        if item.role == "system":
            messages.append(SystemMessage(content=item.content or ""))
        elif item.role == "assistant":
            kwargs: dict[str, Any] = {"content": item.content or ""}
            tool_calls = _openai_tool_calls_to_lc(item.tool_calls)
            if tool_calls:
                kwargs["tool_calls"] = tool_calls
            messages.append(AIMessage(**kwargs))
        elif item.role == "tool":
            messages.append(
                ToolMessage(content=item.content or "", tool_call_id=item.tool_call_id or "")
            )
        else:
            messages.append(HumanMessage(content=item.content or ""))
    return messages


def _sse(data: dict | str) -> str:
    if data == "[DONE]":
        return "data: [DONE]\n\n"
    return f"data: {json.dumps(data, ensure_ascii=False)}\n\n"


def _tool_call_chunk_to_openai(chunk: Any) -> dict:
    if hasattr(chunk, "get"):
        index = chunk.get("index", 0)
        call_id = chunk.get("id")
        name = chunk.get("name")
        args = chunk.get("args") or ""
    else:
        index = getattr(chunk, "index", 0)
        call_id = getattr(chunk, "id", None)
        name = getattr(chunk, "name", None)
        args = getattr(chunk, "args", None) or ""
    if not isinstance(args, str):
        args = json.dumps(args, ensure_ascii=False)
    item: dict[str, Any] = {
        "index": index,
        "type": "function",
        "function": {"arguments": args},
    }
    if call_id:
        item["id"] = call_id
    if name:
        item["function"]["name"] = name
    return item


def _chunk_to_event(chunk: Any) -> dict | None:
    """把 LangChain 流式 chunk 转成 OpenAI 兼容 SSE 事件体。"""
    delta: dict[str, Any] = {}
    content = getattr(chunk, "content", None)
    if content:
        delta["content"] = content
    tool_call_chunks = getattr(chunk, "tool_call_chunks", None) or []
    if tool_call_chunks:
        delta["tool_calls"] = [_tool_call_chunk_to_openai(item) for item in tool_call_chunks]
    if not delta:
        return None
    return {"choices": [{"delta": delta}]}


def _build_chat_model(body: ChatRequest):
    config = settings
    if body.model:
        config = settings.model_copy(update={"chat_model": body.model})
    kwargs: dict[str, Any] = {}
    if body.temperature is not None:
        kwargs["temperature"] = body.temperature
    llm = create_chat_model(config, **kwargs)
    if body.tools:
        try:
            llm = llm.bind_tools([tool.model_dump() for tool in body.tools])
        except (KeyError, TypeError, ValueError) as exc:
            raise BizException("工具定义无效", code=BizCode.BAD_REQUEST) from exc
    return llm


# ══════════════════════════════════════════════════════════════════════════════
# 端点
# ══════════════════════════════════════════════════════════════════════════════


@router.post("/chat")
async def chat(
    body: ChatRequest,
    request: Request,
) -> StreamingResponse:
    """LLM 代理（流式响应）。

    后端职责：
    1. 从 JWT 解析 user_id（用于日志/审计）
    2. 调用 create_chat_model 工厂创建 LLM 实例
    3. 流式转发 LLM 响应
    4. 不解析 tool_calls、不执行工具、不存对话历史
    5. 本端点不计量积分；``model`` 透传给 provider（缺省用 AI_CHAT_MODEL）

    响应格式：OpenAI 兼容 SSE
    ```
    data: {"choices": [{"delta": {"content": "好"}}]}
    data: {"choices": [{"delta": {"tool_calls": [...]}}]}
    data: [DONE]
    ```
    """
    user_id = request.state.current_user.id
    logger.info("ai chat stream user_id=%s model=%s", user_id, body.model)
    try:
        llm = _build_chat_model(body)
    except ValueError as exc:
        raise BizException(str(exc), code=BizCode.MODEL_UNAVAILABLE) from exc

    messages = _to_lc_messages(body)

    async def _forward():
        try:
            async for chunk in llm.astream(messages):
                if await request.is_disconnected():
                    logger.debug("ai chat client disconnected user_id=%s", user_id)
                    break
                event = _chunk_to_event(chunk)
                if event is not None:
                    yield _sse(event)
        except Exception:
            logger.exception("ai chat stream failed user_id=%s", user_id)
            yield _sse({"error": {"message": "模型调用失败", "type": "server_error"}})
            return
        yield _sse("[DONE]")

    return StreamingResponse(
        _forward(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
