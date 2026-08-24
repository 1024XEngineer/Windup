"""项目 CRUD API。"""

import logging
from datetime import datetime

from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from windup_common.enums import ArtStyle
from windup_common.enums.biz_code import BizCode
from windup_common.exceptions import BizException
from windup_common.result import ListResponse, Response
from windup_framework.db import get_session

from windup_app.server.character.service import service as character_service
from windup_app.server.project.service import service

logger = logging.getLogger("windup.project.api")

router = APIRouter(prefix="/projects", tags=["projects"])


def _stored_style(style: ArtStyle | None) -> str | None:
    """``UNSPECIFIED`` 落库存 NULL —— 现有前端把这一列原样显示,写字面量会让它显示出来。"""
    return None if style is None or style is ArtStyle.UNSPECIFIED else style.value


class ProjectCreate(BaseModel):
    """创建项目请求。"""

    workflow_id: int | None = None
    project_name: str = Field(min_length=1, max_length=20)
    character_perspective: int = Field(ge=1, le=3)
    directional_movement: int = Field(ge=1, le=3)
    sprite_width: int = Field(ge=32, le=2048)
    sprite_height: int = Field(ge=32, le=2048)
    game_style: ArtStyle = ArtStyle.UNSPECIFIED
    sprite_sample_url: str | None = None

    @field_validator("game_style", mode="before")
    @classmethod
    def _accept_legacy_free_text(cls, value: object) -> ArtStyle:
        """画风枚举化之前建项目发的是自由文本;直接拒会让还没换下拉的客户端建不了项目。"""
        if value is None:
            return ArtStyle.UNSPECIFIED
        return ArtStyle.from_stored(value) if isinstance(value, str) else value


class ProjectPatch(BaseModel):
    """改项目请求;只改传上来的那些字段。"""

    project_name: str | None = Field(default=None, min_length=1, max_length=20)
    game_style: ArtStyle | None = None

    @model_validator(mode="after")
    def _at_least_one(self) -> "ProjectPatch":
        if self.project_name is None and self.game_style is None:
            raise ValueError("至少要改一个字段")
        return self


class ProjectOut(BaseModel):
    """项目响应。"""

    model_config = ConfigDict(from_attributes=True)

    id: int
    workflow_id: int | None
    project_name: str
    character_perspective: int
    directional_movement: int
    sprite_width: int
    sprite_height: int
    game_style: str | None
    sprite_sample_url: str | None
    create_at: datetime
    update_at: datetime


class ProjectListOut(ProjectOut):
    """项目列表项；预览是读取投影，不写回 Project。"""

    preview_url: str | None


@router.post("", response_model=Response[ProjectOut])
def create_project(
    body: ProjectCreate,
    request: Request,
    session: Session = Depends(get_session),
) -> Response[ProjectOut]:
    user_id = request.state.current_user.id
    if service.project_name_exists(
        session, user_id=user_id, project_name=body.project_name
    ):
        logger.warning(
            "[WINDUP] 创建拒绝-名称重复 | user_id=%s project_name=%s",
            user_id,
            body.project_name,
        )
        raise BizException("项目名称已存在", code=BizCode.BAD_REQUEST)
    try:
        fields = body.model_dump()
        fields["game_style"] = _stored_style(body.game_style)
        project = service.create_project(session, user_id=user_id, **fields)
    except IntegrityError:
        logger.warning(
            "[WINDUP] 创建拒绝-并发冲突 | user_id=%s project_name=%s",
            user_id,
            body.project_name,
        )
        session.rollback()
        raise BizException("项目名称已存在", code=BizCode.BAD_REQUEST) from None
    return Response.success(ProjectOut.model_validate(project), message="创建成功")


@router.get("", response_model=ListResponse[ProjectListOut])
def list_projects(
    request: Request,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    session: Session = Depends(get_session),
) -> ListResponse[ProjectListOut]:
    user_id = request.state.current_user.id
    projects, total = service.list_projects(
        session, page=page, page_size=page_size, user_id=user_id
    )
    previews = service.list_project_previews(
        session,
        [project.id for project in projects],
        character_limit=6,
    )
    return ListResponse.success(
        [
            ProjectListOut(
                **ProjectOut.model_validate(item).model_dump(),
                preview_url=item.sprite_sample_url or previews[item.id],
            )
            for item in projects
        ],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.get("/{project_id}", response_model=Response[ProjectOut])
def get_project(
    project_id: int,
    request: Request,
    session: Session = Depends(get_session),
) -> Response[ProjectOut]:
    project = service.get_project(session, project_id)
    if project is None or project.user_id != request.state.current_user.id:
        raise BizException("项目不存在", code=BizCode.NOT_FOUND)
    return Response.success(ProjectOut.model_validate(project))


@router.patch("/{project_id}", response_model=Response[ProjectOut])
def update_project(
    project_id: int,
    body: ProjectPatch,
    request: Request,
    session: Session = Depends(get_session),
) -> Response[ProjectOut]:
    user_id = request.state.current_user.id
    project = service.get_project(session, project_id, for_update=True)
    if project is None or project.user_id != user_id:
        raise BizException("项目不存在", code=BizCode.NOT_FOUND)
    rename_to = body.project_name if body.project_name != project.project_name else None
    if rename_to is not None and service.project_name_exists(
        session, user_id=user_id, project_name=rename_to
    ):
        raise BizException("项目名称已存在", code=BizCode.BAD_REQUEST)
    try:
        project = service.update_project(
            session,
            project,
            project_name=rename_to,
            game_style=_stored_style(body.game_style) if body.game_style else None,
        )
    except IntegrityError:
        session.rollback()
        raise BizException("项目名称已存在", code=BizCode.BAD_REQUEST) from None
    return Response.success(ProjectOut.model_validate(project), message="修改成功")


@router.delete("/{project_id}", response_model=Response[None])
def delete_project(
    project_id: int,
    request: Request,
    session: Session = Depends(get_session),
) -> Response[None]:
    project = service.get_project(session, project_id, for_update=True)
    if project is None or project.user_id != request.state.current_user.id:
        raise BizException("项目不存在", code=BizCode.NOT_FOUND)
    if character_service.project_has_characters(session, project_id):
        raise BizException("项目下仍有角色，无法删除", code=BizCode.BAD_REQUEST)
    try:
        service.delete_project(session, project_id)
    except IntegrityError:
        session.rollback()
        raise BizException(
            "项目下仍有角色，无法删除", code=BizCode.BAD_REQUEST
        ) from None
    return Response.success(None, message="删除成功")
