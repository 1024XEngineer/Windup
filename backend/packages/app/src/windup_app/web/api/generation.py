"""生成任务 API。

契约层：定义前端请求/响应的 Pydantic 模型，与 server 层解耦。
实际逻辑由 server 层实现，本文件只做参数校验和格式转换。

端点一览
--------
POST /generation/image                     提交角色图片生成任务
POST /generation/action                    提交角色动作生成任务
GET  /generation/tasks/{task_id}           查询任务状态
GET  /generation/tasks/{task_id}/stream    SSE 订阅任务进度
"""

from __future__ import annotations

import asyncio
import dataclasses
import json
import logging
import threading
from collections import defaultdict

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from windup_common.enums.biz_code import BizCode
from windup_common.exceptions import BizException
from windup_common.result import Response
from windup_framework.db import get_session

from windup_app.server.orchestrator.model import (
    CharacterActionInput,
    CharacterImageInput,
    ActionType,
    GenerationTask,
)
from windup_app.server.orchestrator.service import service as generation_service

logger = logging.getLogger("windup.generation.api")

router = APIRouter(prefix="/generation", tags=["generation"])


# ══════════════════════════════════════════════════════════════════════════════
# EventBus（任务进度推送）
# ══════════════════════════════════════════════════════════════════════════════

# 心跳间隔(秒)
_HEARTBEAT_TIMEOUT = 30.0

# 终态状态
_TERMINAL_STATUSES = {"completed", "failed"}


class _EventBus:
    """任务进度内存发布-订阅。"""

    def __init__(self) -> None:
        self._queues: dict[str, list[asyncio.Queue]] = defaultdict(list)

    async def subscribe(self, task_id: int) -> asyncio.Queue:
        queue: asyncio.Queue = asyncio.Queue()
        self._queues[str(task_id)].append(queue)
        return queue

    async def unsubscribe(self, task_id: int, queue: asyncio.Queue) -> None:
        key = str(task_id)
        subs = self._queues.get(key)
        if subs and queue in subs:
            subs.remove(queue)
            if not subs:
                del self._queues[key]

    def publish(self, task_id: int, event: str, data: dict) -> None:
        for queue in self._queues.get(str(task_id), []):
            queue.put_nowait((event, data))


# 全局实例，挂到 app.state.event_bus
event_bus = _EventBus()


# ══════════════════════════════════════════════════════════════════════════════
# 请求/响应模型
# ══════════════════════════════════════════════════════════════════════════════


class CharacterImageGenerateRequest(BaseModel):
    """提交角色图片生成任务。"""

    user_id: int = Field(gt=0)
    project_id: int | None = None
    reference_image_url: str | None = None
    prompt: str = ""
    negative_prompt: str = ""
    width: int = 1024
    height: int = 1024
    num_images: int = 1


class CharacterActionGenerateRequest(BaseModel):
    """提交角色动作生成任务。"""

    user_id: int = Field(gt=0)
    project_id: int | None = None
    character_id: int = Field(gt=0)
    action_type: ActionType
    custom_prompt: str | None = None
    reference_video_url: str | None = None
    reference_image_urls: list[str] = Field(default_factory=list)
    num_frames: int = 16


# ── 响应模型 ─────────────────────────────────────────────────────────────────


class GenerationTaskOut(BaseModel):
    """生成任务响应。"""

    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: int
    project_id: int | None = None
    task_type: str
    status: str
    input_payload: dict | None = None
    result: dict | None = None
    error_message: str | None = None


def _task_to_out(task: GenerationTask) -> GenerationTaskOut:
    """领域 dataclass → 响应模型。"""
    result_dict = None
    if task.result is not None:
        result_dict = dataclasses.asdict(task.result)
    return GenerationTaskOut(
        id=task.id,
        user_id=task.user_id,
        project_id=task.project_id,
        task_type=task.task_type.value,
        status=task.status.value,
        input_payload=task.input_payload,
        result=result_dict,
        error_message=task.error_message,
    )


# ── 端点 ─────────────────────────────────────────────────────────────────────


def _validate_project_size(session: Session, project_id: int | None, width: int, height: int) -> None:
    """校验输入尺寸与项目约束是否一致;不一致则抛异常。"""
    if project_id is None:
        return
    from windup_app.server.project.service import SqlAlchemyProjectService

    project = SqlAlchemyProjectService().get_project(session, project_id)
    if project is None:
        return
    if width != project.sprite_width or height != project.sprite_height:
        raise BizException(
            f"输入尺寸 {width}×{height} 与项目约束 {project.sprite_width}×{project.sprite_height} 不一致",
            code=BizCode.BAD_REQUEST,
        )


@router.post("/image", response_model=Response[GenerationTaskOut])
def submit_image_generation(
    body: CharacterImageGenerateRequest,
    request: Request,
    session: Session = Depends(get_session),
) -> Response[GenerationTaskOut]:
    """提交角色图片生成任务:建 PENDING 记录立即返回,实际图生图后台跑。"""
    _validate_project_size(session, body.project_id, body.width, body.height)
    input_data = CharacterImageInput(
        reference_image_url=body.reference_image_url,
        prompt=body.prompt,
        negative_prompt=body.negative_prompt,
        width=body.width,
        height=body.height,
        num_images=body.num_images,
    )
    task = generation_service.generate_character_image(
        session, user_id=body.user_id, project_id=body.project_id, input=input_data,
    )
    threading.Thread(
        target=request.app.state.run_image_task,
        args=(task.id, input_data, body.project_id),
        daemon=True,
    ).start()
    return Response.success(_task_to_out(task), message="任务已提交")


@router.post("/action", response_model=Response[GenerationTaskOut])
def submit_action_generation(
    body: CharacterActionGenerateRequest,
    request: Request,
    session: Session = Depends(get_session),
) -> Response[GenerationTaskOut]:
    """提交角色动作生成任务:建 PENDING 记录立即返回,实际生成后台跑。"""
    input_data = CharacterActionInput(
        character_id=body.character_id,
        action_type=body.action_type,
        custom_prompt=body.custom_prompt,
        reference_video_url=body.reference_video_url,
        reference_image_urls=body.reference_image_urls,
        num_frames=body.num_frames,
    )
    task = generation_service.generate_character_action(
        session, user_id=body.user_id, project_id=body.project_id, input=input_data,
    )
    # 后台线程自开 session 跑生成(经项目约束 → ai_engine)。调度器由 bootstrap 注入
    # app.state,web 不静态依赖 ai_engine(满足入口层门禁)。
    threading.Thread(
        target=request.app.state.run_action_task,
        args=(task.id, input_data, body.project_id),
        daemon=True,
    ).start()
    return Response.success(_task_to_out(task), message="任务已提交")


@router.get("/tasks/{task_id}", response_model=Response[GenerationTaskOut])
def get_task(
    task_id: int,
    project_id: int = Query(..., gt=0),
    session: Session = Depends(get_session),
) -> Response[GenerationTaskOut]:
    """查询生成任务状态与结果。"""
    task = generation_service.get_task(session, project_id, task_id)
    if task is None:
        raise BizException("任务不存在", code=BizCode.NOT_FOUND)
    return Response.success(_task_to_out(task))


@router.get("/tasks/{task_id}/stream")
async def stream_task(
    task_id: int,
    request: Request,
    project_id: int = Query(..., gt=0),
    session: Session = Depends(get_session),
) -> StreamingResponse:
    """SSE:实时推送任务状态（替代轮询）。

    task_repo 在每次 DB 状态变更后推送完整的 task 数据，
    前端收到的数据结构与 GET /tasks/{task_id} 一致。

    事件类型: ``task_update``（data 为完整 task 对象）
    终态: data.status 为 ``completed`` 或 ``failed`` 时关闭连接。
    """
    # 若任务已处于终态，立即推送并关闭
    task = generation_service.get_task(session, project_id, task_id)

    async def _terminal_generator():
        payload = json.dumps(_task_to_out(task).model_dump(), ensure_ascii=False)
        yield f"event: task_update\ndata: {payload}\n\n"

    if task is not None and task.status.value in _TERMINAL_STATUSES:
        return StreamingResponse(
            _terminal_generator(),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "Connection": "keep-alive", "X-Accel-Buffering": "no"},
        )

    queue = await event_bus.subscribe(task_id)
    logger.debug("SSE 订阅: task_id=%d", task_id)

    async def _event_generator():
        try:
            while True:
                if await request.is_disconnected():
                    logger.debug("SSE 客户端断开: task_id=%d", task_id)
                    break
                try:
                    event, data = await asyncio.wait_for(
                        queue.get(), timeout=_HEARTBEAT_TIMEOUT,
                    )
                    payload = json.dumps(data, ensure_ascii=False)
                    yield f"event: {event}\ndata: {payload}\n\n"
                    if data.get("status") in _TERMINAL_STATUSES:
                        logger.debug("SSE 终态: task_id=%d status=%s", task_id, data.get("status"))
                        break
                except asyncio.TimeoutError:
                    yield ": heartbeat\n\n"
        finally:
            await event_bus.unsubscribe(task_id, queue)
            logger.debug("SSE 取消订阅: task_id=%d", task_id)

    return StreamingResponse(
        _event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
