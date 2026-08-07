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

from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

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

    响应格式：OpenAI 兼容 SSE
    ```
    data: {"choices": [{"delta": {"content": "好"}}]}
    data: {"choices": [{"delta": {"tool_calls": [...]}}]}
    data: [DONE]
    ```
    """
    # TODO: 调用 create_chat_model 创建 LLM 实例，流式转发
    # 当前返回占位实现
    async def _placeholder():
        yield f'data: {json.dumps({"choices": [{"delta": {"content": "AI Proxy 尚未实现，请配置 LLM provider。"}}]}, ensure_ascii=False)}\n\n'
        yield "data: [DONE]\n\n"

    return StreamingResponse(
        _placeholder(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
