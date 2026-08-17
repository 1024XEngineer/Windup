"""角色 CRUD API。"""

import logging

from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from windup_common.enums.biz_code import BizCode
from windup_common.enums.character import CharacterStatus
from windup_common.exceptions import BizException
from windup_common.result import ListResponse, Response
from windup_framework.config.storage import settings as storage_settings
from windup_framework.db import get_session

from windup_app.server.character.model import Character, CharacterData
from windup_app.server.character.service import service as character_service
from windup_app.server.media.service import service as media_service
from windup_app.server.project.model import Project
from windup_app.server.project.service import service as project_service

logger = logging.getLogger("windup.character.api")

router = APIRouter(prefix="/characters", tags=["characters"])


# ── 请求 / 响应模型 ─────────────────────────────────────────────────────────


class CharacterCreate(BaseModel):
    """创建角色请求。"""

    project_id: int = Field(gt=0)
    workflow_run_id: int = Field(gt=0)
    name: str | None = Field(default=None, max_length=20)
    description: str | None = None
    reference_image_url: str | None = None
    character_data: CharacterData = Field(default_factory=CharacterData)


class CharacterUpdate(BaseModel):
    """更新角色请求——所有字段可选。"""

    name: str | None = Field(default=None, max_length=20)
    description: str | None = None
    reference_image_url: str | None = None
    character_data: CharacterData | None = None


class CharacterOut(BaseModel):
    """角色响应。"""

    model_config = ConfigDict(from_attributes=True)

    id: int
    project_id: int
    workflow_run_id: int
    name: str | None = None
    description: str | None = None
    reference_image_url: str | None = None
    character_data: dict
    status: int


# ── 辅助函数 ─────────────────────────────────────────────────────────────────


def _extract_object_keys(character: Character) -> list[str]:
    """从角色中提取所有对象存储 key,用于删除时清理资源。

    URL 格式: ``{download_base}/{object_key}``
    """
    prefix = storage_settings.download_base + "/"
    keys: list[str] = []

    # 参考图
    url = character.reference_image_url
    if url and url.startswith(prefix):
        keys.append(url[len(prefix):])

    # character_data 内的 URL
    data = character.character_data or {}
    for outfit in data.get("outfits", []):
        url = outfit.get("preview_url")
        if url and url.startswith(prefix):
            keys.append(url[len(prefix):])
        for action in outfit.get("actions", []):
            for frame in action.get("frames", []):
                url = frame.get("image_url")
                if url and url.startswith(prefix):
                    keys.append(url[len(prefix):])

    return keys


# ── 归属校验 ─────────────────────────────────────────────────────────────────


def _get_project_or_raise(
    session: Session, project_id: int, user_id: int, *, for_update: bool = False,
) -> Project:
    """校验项目存在且属于当前用户，否则抛 BizException。

    创建角色时 ``for_update=True``，与删除项目锁同一行，避免并发下留下无归属角色。
    """
    project = project_service.get_project(session, project_id, for_update=for_update)
    if project is None or project.user_id != user_id:
        raise BizException("项目不存在", code=BizCode.NOT_FOUND)
    return project


def _get_character_with_auth(
    session: Session, character_id: int, user_id: int,
) -> Character:
    """获取角色并校验其所属项目属于当前用户。

    无论角色不存在还是无权访问,统一返回"角色不存在",避免信息泄露。
    """
    character = character_service.get_character(session, character_id)
    if character is None:
        raise BizException("角色不存在", code=BizCode.NOT_FOUND)
    project = session.get(Project, character.project_id)
    if project is None or project.user_id != user_id:
        raise BizException("角色不存在", code=BizCode.NOT_FOUND)
    return character


# ── 端点 ─────────────────────────────────────────────────────────────────────


@router.post("", response_model=Response[CharacterOut])
def create_character(
    body: CharacterCreate,
    request: Request,
    session: Session = Depends(get_session),
) -> Response[CharacterOut]:
    user_id = request.state.current_user.id
    _get_project_or_raise(session, body.project_id, user_id, for_update=True)
    character_data = body.character_data.model_dump()
    status = CharacterStatus.from_character_data(character_data)
    try:
        character = character_service.create_character(
            session,
            project_id=body.project_id,
            workflow_run_id=body.workflow_run_id,
            name=body.name,
            description=body.description,
            reference_image_url=body.reference_image_url,
            character_data=character_data,
            status=status,
        )
    except IntegrityError as exc:
        session.rollback()
        orig = str(getattr(exc, "orig", exc)).lower()
        if "foreign key" in orig:
            raise BizException("项目不存在", code=BizCode.NOT_FOUND) from None
        character = character_service.get_character_by_workflow_run(
            session,
            body.workflow_run_id,
        )
        if character is None or character.project_id != body.project_id:
            raise BizException("角色不存在", code=BizCode.NOT_FOUND) from None
    return Response.success(CharacterOut.model_validate(character), message="创建成功")


@router.get("", response_model=ListResponse[CharacterOut])
def list_characters(
    project_id: int = Query(..., gt=0),
    request: Request = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    status: int | None = Query(None, ge=0, le=1, description="按发布状态过滤: 0=草稿, 1=已发布"),
    session: Session = Depends(get_session),
) -> ListResponse[CharacterOut]:
    user_id = request.state.current_user.id
    _get_project_or_raise(session, project_id, user_id)
    items, total = character_service.list_characters(
        session, project_id=project_id, page=page, page_size=page_size, status=status,
    )
    return ListResponse.success(
        [CharacterOut.model_validate(c) for c in items],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.get("/{character_id}", response_model=Response[CharacterOut])
def get_character(
    character_id: int,
    request: Request,
    session: Session = Depends(get_session),
) -> Response[CharacterOut]:
    user_id = request.state.current_user.id
    character = _get_character_with_auth(session, character_id, user_id)
    return Response.success(CharacterOut.model_validate(character))


@router.patch("/{character_id}", response_model=Response[CharacterOut])
def update_character(
    character_id: int,
    body: CharacterUpdate,
    request: Request,
    session: Session = Depends(get_session),
) -> Response[CharacterOut]:
    user_id = request.state.current_user.id
    _get_character_with_auth(session, character_id, user_id)
    fields = body.model_dump(exclude_unset=True)
    # 如果更新了 character_data，自动推断 status
    if "character_data" in fields:
        if fields["character_data"] is None:
            raise BizException("character_data 不能为 null", code=BizCode.BAD_REQUEST)
        character_data = fields["character_data"]
        if isinstance(character_data, CharacterData):
            character_data = character_data.model_dump()
        fields["status"] = CharacterStatus.from_character_data(character_data)
    character = character_service.update_character(session, character_id, **fields)
    if character is None:
        raise BizException("角色不存在", code=BizCode.NOT_FOUND)
    return Response.success(CharacterOut.model_validate(character), message="更新成功")


@router.delete("/{character_id}", response_model=Response[None])
def delete_character(
    character_id: int,
    request: Request,
    session: Session = Depends(get_session),
) -> Response[None]:
    user_id = request.state.current_user.id
    character = _get_character_with_auth(session, character_id, user_id)

    # 先提取对象 key,再删 DB 记录
    object_keys = _extract_object_keys(character)

    character_service.delete_character(session, character_id)

    # 清理对象存储——失败只记日志,不回滚 DB
    for key in object_keys:
        try:
            media_service.delete(key)
        except Exception:
            logger.warning("[WINDUP] 媒体清理失败(已跳过) | key=%s", key, exc_info=True)

    return Response.success(None, message="删除成功")
