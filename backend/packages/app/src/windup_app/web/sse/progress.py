"""SSE-aware ProgressPort 实现。

实现 ``windup_ai_engine.ports.ProgressPort`` 协议,将生成管线的每一步
进度通过 ``EventBus`` 广播给 SSE 订阅者。

后台线程调用 ``step`` 时,通过 ``loop.call_soon_threadsafe`` 安全地
将事件发布到 event loop。
"""

from __future__ import annotations

import asyncio

from windup_app.web.sse.event_bus import EventBus


class SSEProgressPort:
    """实现 ProgressPort:每步都 publish 到 EventBus。"""

    def __init__(
        self,
        event_bus: EventBus,
        task_id: int,
        loop: asyncio.AbstractEventLoop,
    ) -> None:
        self._bus = event_bus
        self._task_id = task_id
        self._loop = loop

    def step(self, stage: str, i: int, total: int, note: str = "") -> None:
        """进度回调:从后台线程安全地发布到 event loop。"""
        self._loop.call_soon_threadsafe(
            self._bus.publish_task,
            self._task_id,
            "progress",
            {"stage": stage, "current": i, "total": total, "note": note},
        )
