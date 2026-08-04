"""SSE 流端点（Session mode）—— Agent 多轮对话。

提供 ``GET /agent/sessions/{session_id}/stream`` 端点,
客户端通过 EventSource 订阅 Agent 事件流。

Session mode 特点:
- 持续连接,不自动关闭（除非客户端断开）
- 支持多种事件类型:thinking / message / tool_call / tool_result / status / error
- 双向通信:客户端通过 HTTP POST 发送用户消息
"""

from __future__ import annotations

import asyncio
import json
import logging

from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse

from windup_app.web.sse.event_bus import EventBus, SSEEvent

logger = logging.getLogger("windup.sse.session")

router = APIRouter(prefix="/agent", tags=["sse"])

# SSE 心跳间隔(秒)
_HEARTBEAT_TIMEOUT = 30.0


@router.get("/sessions/{session_id}/stream")
async def stream_session(
    session_id: str,
    request: Request,
) -> StreamingResponse:
    """SSE:Agent 多轮对话事件流。

    事件类型:
      - ``thinking``: Agent 思考过程
      - ``message``: Agent 回复文本
      - ``tool_call``: Agent 调用工具
      - ``tool_result``: 工具返回结果
      - ``status``: 会话状态(waiting_input / processing / done)
      - ``error``: 错误信息

    Session mode 不会自动关闭连接,持续监听直到客户端断开。
    """
    event_bus: EventBus = request.app.state.event_bus
    queue = await event_bus.subscribe_session(session_id)
    logger.debug("SSE Session 订阅: session_id=%s", session_id)

    async def _event_generator():
        try:
            while True:
                if await request.is_disconnected():
                    logger.debug("SSE Session 客户端断开: session_id=%s", session_id)
                    break
                try:
                    event: SSEEvent = await asyncio.wait_for(
                        queue.get(), timeout=_HEARTBEAT_TIMEOUT,
                    )
                    payload = json.dumps(event.data, ensure_ascii=False)
                    yield f"event: {event.event}\ndata: {payload}\n\n"
                except asyncio.TimeoutError:
                    yield ": heartbeat\n\n"
        finally:
            await event_bus.unsubscribe_session(session_id, queue)
            logger.debug("SSE Session 取消订阅: session_id=%s", session_id)

    return StreamingResponse(
        _event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
