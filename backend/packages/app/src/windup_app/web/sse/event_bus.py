"""SSE 通用发布-订阅中心。

纯基础设施模块，只提供 channel 级别的发布/订阅能力，不关心调用方是谁。

调用方自定义 channel 命名（如 ``task:123``、``run:456:node:7``），
EventBus 只负责将事件推送给对应 channel 的订阅者。

线程安全:``publish`` 可从任意线程调用,``subscribe``/``unsubscribe`` 须在
event loop 中调用（FastAPI 路由天然满足）。
"""

from __future__ import annotations

import asyncio
from collections import defaultdict
from dataclasses import dataclass


@dataclass(frozen=True)
class SSEEvent:
    """统一 SSE 事件。"""

    channel: str  # 频道名（如 "task:123"）
    event: str    # 事件类型（如 "progress"、"completed"、"failed"）
    data: dict    # 事件数据


class EventBus:
    """内存发布-订阅:后台线程 publish,异步 SSE generator subscribe。"""

    def __init__(self) -> None:
        self._queues: dict[str, list[asyncio.Queue[SSEEvent]]] = defaultdict(list)

    async def subscribe(self, channel: str) -> asyncio.Queue[SSEEvent]:
        """订阅频道事件流。"""
        queue: asyncio.Queue[SSEEvent] = asyncio.Queue()
        self._queues[channel].append(queue)
        return queue

    async def unsubscribe(self, channel: str, queue: asyncio.Queue[SSEEvent]) -> None:
        """取消订阅。"""
        subscribers = self._queues.get(channel)
        if subscribers and queue in subscribers:
            subscribers.remove(queue)
            if not subscribers:
                del self._queues[channel]

    def publish(self, channel: str, event: str, data: dict) -> None:
        """发布事件。线程安全（put_nowait 无阻塞）。"""
        sse_event = SSEEvent(channel=channel, event=event, data=data)
        for queue in self._queues.get(channel, []):
            queue.put_nowait(sse_event)
