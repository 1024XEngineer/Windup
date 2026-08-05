"""生成任务 API。"""

import asyncio
import dataclasses
import json
import logging
import threading
from collections.abc import AsyncIterator

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from windup_common.enums.biz_code import BizCode
from windup_common.exceptions import BizException
from windup_common.result import Response
from windup_framework.db import get_session

from windup_app.server.generation.model import (
    CharacterActionInput,
    CharacterImageInput,
    ActionType,
    DEFAULT_ACTION_FRAME_COUNT,
    GenerationTask,
)
from windup_app.server.generation.service import service as generation_service

logger = logging.getLogger("windup.generation.api")

router = APIRouter(prefix="/generation", tags=["generation"])


# ── 请求模型 ─────────────────────────────────────────────────────────────────


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
    num_frames: int = DEFAULT_ACTION_FRAME_COUNT


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


def _validate_project_size(
    session: Session, project_id: int | None, width: int, height: int
) -> None:
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
        session,
        user_id=body.user_id,
        project_id=body.project_id,
        input=input_data,
    )
    # 后台执行器使用独立 session；必须先提交，否则它可能读不到刚创建的任务，
    # 最终生成成功也无法写回，任务会永久停在 PENDING。
    session.commit()
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
        session,
        user_id=body.user_id,
        project_id=body.project_id,
        input=input_data,
    )
    # 同图片任务：先让任务记录对后台 session 可见，再启动生成线程。
    session.commit()
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


def _task_event(task: GenerationTask) -> str:
    """把任务快照编码成前端 GenerationApis 约定的命名 SSE 事件。"""
    payload = _task_to_out(task).model_dump()
    payload["task_id"] = payload.pop("id")
    return f"event: task_update\ndata: {json.dumps(payload, ensure_ascii=False)}\n\n"


async def _task_event_stream(
    request: Request,
    session: Session,
    project_id: int,
    task_id: int,
) -> AsyncIterator[str]:
    """发送当前任务快照，并持续查询数据库直到任务进入终态。"""
    last_update = None
    while not await request.is_disconnected():
        # 结束上一轮读取事务，确保能看到后台 session 已提交的新状态。
        session.rollback()
        task = generation_service.get_task(session, project_id, task_id)
        if task is None:
            return
        update_key = (task.status, task.update_at, task.error_message)
        if update_key != last_update:
            yield _task_event(task)
            last_update = update_key
        if task.status.value in {"completed", "failed"}:
            return
        await asyncio.sleep(1)


@router.get("/tasks/{task_id}/stream")
def stream_task(
    task_id: int,
    request: Request,
    project_id: int = Query(..., gt=0),
    session: Session = Depends(get_session),
) -> StreamingResponse:
    """订阅生成任务状态；连接建立后先发送当前快照，终态后自动关闭。"""
    task = generation_service.get_task(session, project_id, task_id)
    if task is None:
        raise BizException("任务不存在", code=BizCode.NOT_FOUND)
    return StreamingResponse(
        _task_event_stream(request, session, project_id, task_id),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
