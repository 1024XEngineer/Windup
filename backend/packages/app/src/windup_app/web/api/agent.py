"""Agent 智能体 API。

懒人智能体：一句话搞定角色资产生成。
用户通过自然语言与 Agent 对话，Agent 自动调用工具完成项目创建、角色生成、动作生成等操作。

端点一览
--------
POST   /agent/sessions                          创建 Agent 会话
GET    /agent/sessions/{session_id}/stream      Agent SSE 事件流
POST   /agent/sessions/{session_id}/messages    发送用户消息
POST   /agent/sessions/{session_id}/choices     发送用户选择（按钮点击）
GET    /agent/sessions/{session_id}/messages    获取会话历史

SSE 事件类型
-----------
- message:      Agent 回复（富内容：text/image/buttons/confirm/progress）
- tool_call:    Agent 调用工具（含 task_id，可订阅 Task SSE 获取进度）
- tool_result:  工具返回结果
- state_change: Agent 状态变更（processing/waiting_input/done）
- error:        错误信息
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from windup_common.result import Response, ListResponse
from windup_framework.db import get_session

logger = logging.getLogger("windup.agent.api")

router = APIRouter(prefix="/agent", tags=["agent"])


# ══════════════════════════════════════════════════════════════════════════════
# 请求模型
# ══════════════════════════════════════════════════════════════════════════════


class SessionCreateRequest(BaseModel):
    """创建 Agent 会话。"""

    user_id: int = Field(description="用户 ID")
    context: dict | None = Field(
        default=None,
        description="初始上下文，如 {project_id: 123}。可选，后续通过对话补充。",
    )


class MessageSendRequest(BaseModel):
    """发送用户消息。"""

    content: str = Field(min_length=1, max_length=2000, description="用户消息内容")
    message_id: str | None = Field(
        default=None,
        description="客户端消息 ID（用于去重），省略则由后端生成",
    )


class ChoiceSendRequest(BaseModel):
    """发送用户选择（按钮点击）。"""

    message_id: str = Field(description="对应的 Agent 消息 ID（buttons 块所在的 message）")
    value: str = Field(description="选择的值（ButtonOption.value）")


# ══════════════════════════════════════════════════════════════════════════════
# 响应模型
# ══════════════════════════════════════════════════════════════════════════════


class SessionOut(BaseModel):
    """会话响应。"""

    model_config = ConfigDict(from_attributes=True)

    session_id: str = Field(description="会话 ID，用于后续 SSE 订阅和消息发送")
    created_at: str = Field(description="创建时间（ISO 8601）")


class MessageOut(BaseModel):
    """消息响应。"""

    model_config = ConfigDict(from_attributes=True)

    message_id: str = Field(description="消息 ID")
    role: str = Field(description="角色：user / assistant")
    blocks: list[dict] = Field(
        default_factory=list,
        description="内容块列表，结构见 ContentBlock 定义",
    )
    state: str | None = Field(
        default=None,
        description="Agent 状态：processing / waiting_input / done（仅 assistant 消息）",
    )
    timestamp: float = Field(description="时间戳（秒）")


# ══════════════════════════════════════════════════════════════════════════════
# 端点
# ══════════════════════════════════════════════════════════════════════════════


@router.post("/sessions", response_model=Response[SessionOut])
def create_session(
    body: SessionCreateRequest,
    session: Session = Depends(get_session),
) -> Response[SessionOut]:
    """创建 Agent 会话。

    返回 session_id，前端用于：
    1. 订阅 Agent SSE：GET /agent/sessions/{session_id}/stream
    2. 发送消息：POST /agent/sessions/{session_id}/messages
    3. 发送选择：POST /agent/sessions/{session_id}/choices
    """
    # TODO: agent_service.create_session
    raise NotImplementedError


@router.post("/sessions/{session_id}/messages", response_model=Response[MessageOut])
def send_message(
    session_id: str,
    body: MessageSendRequest,
    session: Session = Depends(get_session),
) -> Response[MessageOut]:
    """发送用户消息。

    Agent 收到消息后通过 SSE 推送处理结果（message/tool_call/tool_result 等事件）。
    """
    # TODO: agent_service.send_message
    raise NotImplementedError


@router.post("/sessions/{session_id}/choices", response_model=Response[None])
def send_choice(
    session_id: str,
    body: ChoiceSendRequest,
    session: Session = Depends(get_session),
) -> Response[None]:
    """发送用户选择（按钮点击）。

    对应 Agent 消息中的 buttons 块。Agent 收到后继续处理。
    """
    # TODO: agent_service.send_choice
    raise NotImplementedError


@router.get("/sessions/{session_id}/messages", response_model=ListResponse[MessageOut])
def get_messages(
    session_id: str,
    limit: int = 50,
    before: str | None = None,
    session: Session = Depends(get_session),
) -> ListResponse[MessageOut]:
    """获取会话历史消息。

    参数：
    - limit: 返回条数，默认50
    - before: 分页，此 message_id 之前的消息
    """
    # TODO: agent_service.get_messages
    raise NotImplementedError
