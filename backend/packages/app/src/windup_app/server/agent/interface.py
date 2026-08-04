"""Agent 智能体领域服务接口。

懒人智能体：一句话搞定角色资产生成。
用户通过自然语言与 Agent 对话，Agent 自动调用工具完成项目创建、角色生成、动作生成等操作。

调用流程
--------
1. 前端调用 ``POST /agent/sessions`` 创建会话，拿到 ``session_id``。
2. 前端订阅 ``GET /agent/sessions/{session_id}/stream`` 获取 Agent 事件流。
3. 前端调用 ``POST /agent/sessions/{session_id}/messages`` 发送用户消息。
4. Agent 通过 SSE 推送处理结果（message/tool_call/tool_result 等事件）。
5. 若 tool_call 含 task_id，前端订阅 Task SSE 获取生成进度。

工具定义
--------
Agent 可调用的工具（通过 SSE tool_call 事件推送）：

- ``create_project``: 创建项目（返回 project_id）
- ``create_character``: 创建角色（返回 character_id）
- ``generate_character_image``: 生成角色图片（返回 task_id，可订阅 Task SSE）
- ``generate_character_action``: 生成角色动作（返回 task_id，可订阅 Task SSE）
"""

from __future__ import annotations

from abc import ABC, abstractmethod

from windup_app.server.agent.model import (
    AgentMessage,
    AgentSession,
    ToolCall,
)


class AgentService(ABC):
    """Agent 用例的抽象边界。"""

    # -- 会话管理 ----------------------------------------------------------

    @abstractmethod
    def create_session(self, *, user_id: int, context: dict | None = None) -> AgentSession:
        """创建 Agent 会话。

        返回的 session_id 用于 SSE 订阅和消息发送。
        """

    @abstractmethod
    def get_session(self, session_id: str) -> AgentSession | None:
        """获取会话信息。"""

    @abstractmethod
    def close_session(self, session_id: str) -> None:
        """关闭会话。"""

    # -- 消息交互 ----------------------------------------------------------

    @abstractmethod
    def send_message(self, session_id: str, *, content: str, message_id: str | None = None) -> AgentMessage:
        """发送用户消息。

        Agent 收到消息后异步处理，通过 SSE 推送结果。
        返回用户消息记录。
        """

    @abstractmethod
    def send_choice(self, session_id: str, *, message_id: str, value: str) -> None:
        """发送用户选择（按钮点击）。

        对应 Agent 消息中的 buttons 块。
        """

    @abstractmethod
    def get_messages(
        self,
        session_id: str,
        *,
        limit: int = 50,
        before: str | None = None,
    ) -> list[AgentMessage]:
        """获取会话历史消息。

        参数：
        - limit: 返回条数，默认50
        - before: 分页，此 message_id 之前的消息
        """

    # -- 工具调用记录 ------------------------------------------------------

    @abstractmethod
    def get_tool_calls(self, session_id: str) -> list[ToolCall]:
        """获取会话的全部工具调用记录。"""
