"""Agent 智能体领域模型。

懒人智能体：一句话搞定角色资产生成。
用户通过自然语言与 Agent 对话，Agent 自动调用工具完成项目创建、角色生成、动作生成等操作。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import StrEnum


# -- 枚举 ----------------------------------------------------------------


class SessionStatus(StrEnum):
    """会话状态。"""

    ACTIVE = "active"
    CLOSED = "closed"


class MessageRole(StrEnum):
    """消息角色。"""

    USER = "user"
    ASSISTANT = "assistant"


class AgentState(StrEnum):
    """Agent 状态（仅 assistant 消息）。"""

    PROCESSING = "processing"       # Agent 正在处理
    WAITING_INPUT = "waiting_input" # 等待用户输入
    DONE = "done"                   # 处理完成


class ToolName(StrEnum):
    """已定义的工具名称。"""

    CREATE_PROJECT = "create_project"
    CREATE_CHARACTER = "create_character"
    GENERATE_CHARACTER_IMAGE = "generate_character_image"
    GENERATE_CHARACTER_ACTION = "generate_character_action"


# -- 会话 ---------------------------------------------------------------


@dataclass
class AgentSession:
    """Agent 会话。"""

    id: int | None = None
    session_id: str = ""
    user_id: int = 0
    project_id: int | None = None
    status: SessionStatus = SessionStatus.ACTIVE
    context: dict = field(default_factory=dict)
    create_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    update_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))


# -- 消息 ---------------------------------------------------------------


@dataclass
class ContentBlock:
    """内容块——Agent 消息的基本单元。"""

    type: str = ""  # text / image / buttons / confirm / progress / divider / markdown / code
    # text / markdown / code
    content: str = ""
    # image
    url: str = ""
    caption: str = ""
    # buttons / confirm
    prompt: str = ""
    options: list[dict] = field(default_factory=list)  # [{value, label, icon?}]
    confirm_label: str = "确认"
    reject_label: str = "取消"
    # progress
    stage: str = ""
    current: int = 0
    total: int = 0
    text: str = ""
    # code
    language: str = ""


@dataclass
class AgentMessage:
    """Agent 消息。"""

    id: int | None = None
    session_id: str = ""
    message_id: str = ""
    role: MessageRole = MessageRole.USER
    blocks: list[ContentBlock] = field(default_factory=list)
    state: AgentState | None = None
    create_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))


# -- 工具调用 -----------------------------------------------------------


@dataclass
class ToolCall:
    """Agent 工具调用。"""

    id: int | None = None
    session_id: str = ""
    message_id: str = ""
    call_id: str = ""
    tool_name: ToolName = ToolName.CREATE_PROJECT
    arguments: dict = field(default_factory=dict)
    result: dict | None = None
    error: str | None = None
    task_id: int | None = None
    create_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
