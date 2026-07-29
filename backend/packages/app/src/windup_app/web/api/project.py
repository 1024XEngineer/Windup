"""项目 CRUD API。"""

import logging
from datetime import datetime

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from windup_common.enums.biz_code import BizCode
from windup_common.exceptions import BizException
from windup_common.result import ListResponse, Response
from windup_framework.db import get_session

from windup_app.server.project.service import service

logger = logging.getLogger("windup.project.api")

router = APIRouter(prefix="/projects", tags=["projects"])


class ProjectCreate(BaseModel):
    """创建项目请求。"""

    user_id: int = Field(gt=0)
    workflow_id: int | None = None
    project_name: str = Field(min_length=1, max_length=20)
    character_perspective: int = Field(ge=1, le=3)
    directional_movement: int = Field(ge=1, le=3)
    sprite_width: int = Field(ge=32, le=2048)
    sprite_height: int = Field(ge=32, le=2048)
    game_style: str | None = None
    sprite_sample_url: str | None = None


class ProjectOut(ProjectCreate):
    """项目响应。"""

    model_config = ConfigDict(from_attributes=True)

    id: int
    create_at: datetime
    update_at: datetime


@router.post("", response_model=Response[ProjectOut])
def create_project(
    body: ProjectCreate, session: Session = Depends(get_session)
) -> Response[ProjectOut]:
    if service.project_name_exists(
        session, user_id=body.user_id, project_name=body.project_name
    ):
        logger.warning(
            "[WINDUP] 创建拒绝-名称重复 | user_id=%s project_name=%s",
            body.user_id, body.project_name,
        )
        raise BizException("项目名称已存在", code=BizCode.BAD_REQUEST)
    try:
        project = service.create_project(session, **body.model_dump())
    except IntegrityError:
        logger.warning(
            "[WINDUP] 创建拒绝-并发冲突 | user_id=%s project_name=%s",
            body.user_id, body.project_name,
        )
        session.rollback()
        raise BizException("项目名称已存在", code=BizCode.BAD_REQUEST) from None
    return Response.success(ProjectOut.model_validate(project), message="创建成功")


@router.get("", response_model=ListResponse[ProjectOut])
def list_projects(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    user_id: int | None = Query(None, gt=0),
    session: Session = Depends(get_session),
) -> ListResponse[ProjectOut]:
    projects, total = service.list_projects(
        session, page=page, page_size=page_size, user_id=user_id
    )
    return ListResponse.success(
        [ProjectOut.model_validate(item) for item in projects],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.get("/{project_id}", response_model=Response[ProjectOut])
def get_project(
    project_id: int, session: Session = Depends(get_session)
) -> Response[ProjectOut]:
    project = service.get_project(session, project_id)
    if project is None:
        raise BizException("项目不存在", code=BizCode.NOT_FOUND)
    return Response.success(ProjectOut.model_validate(project))


@router.delete("/{project_id}", response_model=Response[None])
def delete_project(
    project_id: int, session: Session = Depends(get_session)
) -> Response[None]:
    if not service.delete_project(session, project_id):
        raise BizException("项目不存在", code=BizCode.NOT_FOUND)
    return Response.success(None, message="删除成功")
