"""Agent 智能体 API Schema。

定义前端请求/响应的 Pydantic 模型，与 server 层解耦。
前端团队参考此文件了解接口契约。
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field


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


class ContentBlockOut(BaseModel):
    """内容块响应。"""

    type: str = Field(description="块类型：text/image/buttons/confirm/progress/divider/markdown/code")
    # text / markdown / code
    content: str | None = None
    # image
    url: str | None = None
    caption: str | None = None
    # buttons
    prompt: str | None = None
    options: list[dict] | None = None  # [{value, label, icon?}]
    # confirm
    confirm_label: str | None = None
    reject_label: str | None = None
    # progress
    stage: str | None = None
    current: int | None = None
    total: int | None = None
    text: str | None = None
    # code
    language: str | None = None


class MessageOut(BaseModel):
    """消息响应。"""

    model_config = ConfigDict(from_attributes=True)

    message_id: str = Field(description="消息 ID")
    session_id: str = Field(description="会话 ID")
    role: str = Field(description="角色：user / assistant")
    blocks: list[ContentBlockOut] = Field(
        default_factory=list,
        description="内容块列表",
    )
    state: str | None = Field(
        default=None,
        description="Agent 状态：processing / waiting_input / done（仅 assistant 消息）",
    )
    timestamp: float = Field(description="时间戳（秒）")


class ToolCallOut(BaseModel):
    """工具调用响应。"""

    model_config = ConfigDict(from_attributes=True)

    call_id: str = Field(description="调用 ID")
    tool: str = Field(description="工具名称")
    args: dict = Field(default_factory=dict, description="工具参数")
    task_id: int | None = Field(default=None, description="任务 ID（生成任务时有值，可订阅 Task SSE）")
    message: str | None = Field(default=None, description="说明文字")


class ToolResultOut(BaseModel):
    """工具结果响应。"""

    model_config = ConfigDict(from_attributes=True)

    call_id: str = Field(description="关联的 tool_call ID")
    tool: str = Field(description="工具名称")
    result: dict | None = Field(default=None, description="工具返回结果")
    error: str | None = Field(default=None, description="错误信息（失败时）")


# ══════════════════════════════════════════════════════════════════════════════
# SSE 事件结构（前端参考）
# ══════════════════════════════════════════════════════════════════════════════
#
# ── Agent SSE 事件类型 ──
#
# event: message
# data: {
#     "message_id": "msg_001",
#     "session_id": "session_abc123",
#     "role": "assistant",
#     "blocks": [
#         {"type": "text", "content": "好的，我需要了解几个细节："},
#         {"type": "buttons", "prompt": "游戏类型", "options": [
#             {"value": "side_scroller", "label": "横版游戏"},
#             {"value": "top_down", "label": "俯视角"}
#         ]}
#     ],
#     "state": "waiting_input",
#     "timestamp": 1234567890.123
# }
#
# event: tool_call
# data: {
#     "call_id": "c1",
#     "tool": "create_project",
#     "args": {"name": "甲壳虫", "perspective": 1},
#     "task_id": null,
#     "message": "正在创建项目..."
# }
#
# event: tool_result
# data: {
#     "call_id": "c1",
#     "tool": "create_project",
#     "result": {"project_id": 123},
#     "error": null
# }
#
# event: state_change
# data: {
#     "state": "waiting_input",
#     "previous_state": "processing"
# }
#
# event: error
# data: {
#     "error": "会话已过期",
#     "code": "SESSION_EXPIRED"
# }
