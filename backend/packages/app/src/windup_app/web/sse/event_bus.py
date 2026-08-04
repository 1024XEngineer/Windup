"""SSE 内存发布-订阅中心（双模式）。

支持两种订阅模式:

- **Task mode**: ``task_id → events → 终态关闭``（用于生成任务进度推送）
- **Session mode**: ``session_id → events → 持续连接``（用于 Agent 多轮对话）

线程安全:``publish`` 可从任意线程调用,``subscribe``/``unsubscribe`` 须在
event loop 中调用(AsyncAPI 路由天然满足)。
"""

from __future__ import annotations

import asyncio
from collections import defaultdict
from dataclasses import dataclass


@dataclass(frozen=True)
class SSEEvent:
    """统一 SSE 事件。"""

    id: str       # 任务 ID(str) 或会话 ID
    id_type: str  # "task" | "session"
    event: str    # 事件类型
    data: dict    # 事件数据


class EventBus:
    """内存发布-订阅:后台线程 publish,异步 SSE generator subscribe。"""

    def __init__(self) -> None:
        # Task mode: task_id(str) → subscriber queues
        self._task_queues: dict[str, list[asyncio.Queue[SSEEvent]]] = defaultdict(list)
        # Session mode: session_id → subscriber queues
        self._session_queues: dict[str, list[asyncio.Queue[SSEEvent]]] = defaultdict(list)

    # ── Task mode ─────────────────────────────────────────────────────────

    async def subscribe_task(self, task_id: int) -> asyncio.Queue[SSEEvent]:
        """订阅任务事件流。"""
        key = str(task_id)
        queue: asyncio.Queue[SSEEvent] = asyncio.Queue()
        self._task_queues[key].append(queue)
        return queue

    async def unsubscribe_task(self, task_id: int, queue: asyncio.Queue[SSEEvent]) -> None:
        """取消任务订阅。"""
        key = str(task_id)
        subscribers = self._task_queues.get(key)
        if subscribers and queue in subscribers:
            subscribers.remove(queue)
            if not subscribers:
                del self._task_queues[key]

    def publish_task(self, task_id: int, event: str, data: dict) -> None:
        """发布任务事件。线程安全(put_nowait 无阻塞)。"""
        key = str(task_id)
        sse_event = SSEEvent(id=key, id_type="task", event=event, data=data)
        for queue in self._task_queues.get(key, []):
            queue.put_nowait(sse_event)

    # ── Session mode ──────────────────────────────────────────────────────

    async def subscribe_session(self, session_id: str) -> asyncio.Queue[SSEEvent]:
        """订阅会话事件流（Agent 多轮对话）。"""
        queue: asyncio.Queue[SSEEvent] = asyncio.Queue()
        self._session_queues[session_id].append(queue)
        return queue

    async def unsubscribe_session(self, session_id: str, queue: asyncio.Queue[SSEEvent]) -> None:
        """取消会话订阅。"""
        subscribers = self._session_queues.get(session_id)
        if subscribers and queue in subscribers:
            subscribers.remove(queue)
            if not subscribers:
                del self._session_queues[session_id]

    def publish_session(self, session_id: str, event: str, data: dict) -> None:
        """发布会话事件。线程安全(put_nowait 无阻塞)。"""
        sse_event = SSEEvent(id=session_id, id_type="session", event=event, data=data)
        for queue in self._session_queues.get(session_id, []):
            queue.put_nowait(sse_event)
