"""SSE 通用推送端点。

提供 ``GET /sse/{channel}/stream`` 端点，客户端通过 EventSource 订阅任意频道的事件流。

本模块是纯基础设施，不引用任何业务域代码。调用方通过 EventBus.publish(channel, event, data)
发布事件，本端点负责将事件流式推送给订阅者。

行为:
- 收到 ``completed`` 或 ``failed`` 事件后关闭连接
- 超时无事件则发送心跳保活
"""

from __future__ import annotations

import asyncio
import json
import logging

from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse

from windup_app.web.sse.event_bus import EventBus, SSEEvent

logger = logging.getLogger("windup.sse.stream")

router = APIRouter(tags=["sse"])

# SSE 心跳间隔(秒):超过此时间无事件则发送注释保活
_HEARTBEAT_TIMEOUT = 30.0

# 收到这些事件类型后关闭连接
_TERMINAL_EVENTS = {"completed", "failed"}


@router.get("/sse/{channel}/stream")
async def stream_channel(
    channel: str,
    request: Request,
) -> StreamingResponse:
    """SSE:订阅指定频道的事件流。

    频道名由调用方自定义（如 ``task:123``、``run:456:node:7``）。
    事件类型和数据结构由调用方定义，本端点只负责推送。
    """
    event_bus: EventBus = request.app.state.event_bus
    queue = await event_bus.subscribe(channel)
    logger.debug("SSE 订阅: channel=%s", channel)

    async def _event_generator():
        try:
            while True:
                if await request.is_disconnected():
                    logger.debug("SSE 客户端断开: channel=%s", channel)
                    break
                try:
                    event: SSEEvent = await asyncio.wait_for(
                        queue.get(), timeout=_HEARTBEAT_TIMEOUT,
                    )
                    payload = json.dumps(event.data, ensure_ascii=False)
                    yield f"event: {event.event}\ndata: {payload}\n\n"
                    if event.event in _TERMINAL_EVENTS:
                        logger.debug("SSE 终态: channel=%s event=%s", channel, event.event)
                        break
                except asyncio.TimeoutError:
                    yield ": heartbeat\n\n"
        finally:
            await event_bus.unsubscribe(channel, queue)
            logger.debug("SSE 取消订阅: channel=%s", channel)

    return StreamingResponse(
        _event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",  # nginx 透传
        },
    )
