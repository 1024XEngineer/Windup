"""生成任务 API。"""

import logging
import threading

from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from windup_common.enums.biz_code import BizCode
from windup_common.exceptions import BizException
from windup_common.result import Response
from windup_framework.db import get_session

from windup_app.server.generation.model import (
    CharacterActionInput,
    CharacterActionOutput,
    CharacterImageInput,
    CharacterImageOutput,
    ActionType,
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
    reference_image_url: str
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
        if isinstance(task.result, CharacterImageOutput):
            result_dict = {"type": "character_image", "image_url": task.result.image_url}
        elif isinstance(task.result, CharacterActionOutput):
            result_dict = {
                "type": "character_action",
                "action_type": task.result.action_type,
                "frames": [
                    {"index": f.index, "image_url": f.image_url, "duration_ms": f.duration_ms}
                    for f in task.result.frames
                ],
            }
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


@router.post("/image", response_model=Response[GenerationTaskOut])
def submit_image_generation(
    body: CharacterImageGenerateRequest,
    request: Request,
    session: Session = Depends(get_session),
) -> Response[GenerationTaskOut]:
    """提交角色图片生成任务:建 PENDING 记录立即返回,实际图生图后台跑。"""
    input_data = CharacterImageInput(
        reference_image_url=body.reference_image_url,
        prompt=body.prompt,
        negative_prompt=body.negative_prompt,
        width=body.width,
        height=body.height,
        num_images=body.num_images,
    )
    task = generation_service.generate_character_image(
        session, user_id=body.user_id, input=input_data,
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
        session, user_id=body.user_id, input=input_data,
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
