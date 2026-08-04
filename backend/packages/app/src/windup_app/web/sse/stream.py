"""SSE 流端点（Task mode）。

提供 ``GET /generation/tasks/{task_id}/stream`` 端点,
客户端通过 EventSource 订阅任务进度推送。
"""

from __future__ import annotations

import asyncio
import dataclasses
import json
import logging

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from windup_app.server.orchestrator.model import TaskStatus
from windup_app.web.sse.event_bus import EventBus, SSEEvent
from windup_framework.db import get_session

logger = logging.getLogger("windup.sse.stream")

router = APIRouter(prefix="/generation", tags=["sse"])

# SSE 心跳间隔(秒):超过此时间无事件则发送注释保活
_HEARTBEAT_TIMEOUT = 30.0


def _task_to_sse_data(task) -> dict | None:
    """任务领域对象 → SSE 事件 data(仅终态)。"""
    if task.status == TaskStatus.COMPLETED:
        result_dict = None
        if task.result is not None:
            result_dict = dataclasses.asdict(task.result)
        return result_dict or {}
    if task.status == TaskStatus.FAILED:
        return {"error": task.error_message or "未知错误"}
    return None


@router.get("/tasks/{task_id}/stream")
async def stream_task(
    task_id: int,
    request: Request,
    project_id: int = Query(..., gt=0),
    session: Session = Depends(get_session),
) -> StreamingResponse:
    """SSE:实时推送任务进度与最终结果。

    事件类型:
      - ``status``: 任务状态变更(pending/running/completed/failed)
      - ``progress``: 生成管线进度(stage/current/total)
      - ``completed``: 任务完成,携带最终结果
      - ``failed``: 任务失败,携带错误信息

    若客户端订阅时任务已处于终态,立即推送终态事件并关闭连接。
    """
    from windup_app.server.orchestrator.service import service as generation_service

    event_bus: EventBus = request.app.state.event_bus

    # 检查任务初始状态:若已终态,立即推送并关闭
    task = generation_service.get_task(session, project_id, task_id)
    if task is not None and task.status in (TaskStatus.COMPLETED, TaskStatus.FAILED):
        event = "completed" if task.status == TaskStatus.COMPLETED else "failed"
        data = _task_to_sse_data(task) or {}

        async def _immediate():
            yield f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"

        return StreamingResponse(
            _immediate(),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "Connection": "keep-alive"},
        )

    # 订阅事件流
    queue = await event_bus.subscribe_task(task_id)
    logger.debug("SSE 订阅: task_id=%d", task_id)

    async def _event_generator():
        try:
            while True:
                if await request.is_disconnected():
                    logger.debug("SSE 客户端断开: task_id=%d", task_id)
                    break
                try:
                    event: SSEEvent = await asyncio.wait_for(
                        queue.get(), timeout=_HEARTBEAT_TIMEOUT,
                    )
                    payload = json.dumps(event.data, ensure_ascii=False)
                    yield f"event: {event.event}\ndata: {payload}\n\n"
                    if event.event in ("completed", "failed"):
                        logger.debug("SSE 终态: task_id=%d event=%s", task_id, event.event)
                        break
                except asyncio.TimeoutError:
                    yield ": heartbeat\n\n"
        finally:
            await event_bus.unsubscribe_task(task_id, queue)
            logger.debug("SSE 取消订阅: task_id=%d", task_id)

    return StreamingResponse(
        _event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",  # nginx 透传
        },
    )
