"""角色 CRUD API。"""

import logging

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from windup_common.enums.biz_code import BizCode
from windup_common.exceptions import BizException
from windup_common.result import ListResponse, Response
from windup_framework.config.storage import settings as storage_settings
from windup_framework.db import get_session

from windup_app.server.character.model import Character, CharacterData
from windup_app.server.character.service import service as character_service
from windup_app.server.media.service import service as media_service

logger = logging.getLogger("windup.character.api")

router = APIRouter(prefix="/characters", tags=["characters"])


# ── 请求 / 响应模型 ─────────────────────────────────────────────────────────


class CharacterCreate(BaseModel):
    """创建角色请求。"""

    project_id: int = Field(gt=0)
    description: str | None = None
    reference_image_url: str | None = None
    character_data: CharacterData = Field(default_factory=CharacterData)


class CharacterUpdate(BaseModel):
    """更新角色请求——所有字段可选。"""

    description: str | None = None
    reference_image_url: str | None = None
    character_data: CharacterData | None = None


class CharacterOut(BaseModel):
    """角色响应。"""

    model_config = ConfigDict(from_attributes=True)

    id: int
    project_id: int
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


# ── 端点 ─────────────────────────────────────────────────────────────────────


@router.post("", response_model=Response[CharacterOut])
def create_character(
    body: CharacterCreate, session: Session = Depends(get_session),
) -> Response[CharacterOut]:
    character = character_service.create_character(
        session,
        project_id=body.project_id,
        description=body.description,
        reference_image_url=body.reference_image_url,
        character_data=body.character_data.model_dump(),
    )
    return Response.success(CharacterOut.model_validate(character), message="创建成功")


@router.get("", response_model=ListResponse[CharacterOut])
def list_characters(
    project_id: int = Query(..., gt=0),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    session: Session = Depends(get_session),
) -> ListResponse[CharacterOut]:
    items, total = character_service.list_characters(
        session, project_id=project_id, page=page, page_size=page_size,
    )
    return ListResponse.success(
        [CharacterOut.model_validate(c) for c in items],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.get("/{character_id}", response_model=Response[CharacterOut])
def get_character(
    character_id: int, session: Session = Depends(get_session),
) -> Response[CharacterOut]:
    character = character_service.get_character(session, character_id)
    if character is None:
        raise BizException("角色不存在", code=BizCode.NOT_FOUND)
    return Response.success(CharacterOut.model_validate(character))


@router.patch("/{character_id}", response_model=Response[CharacterOut])
def update_character(
    character_id: int,
    body: CharacterUpdate,
    session: Session = Depends(get_session),
) -> Response[CharacterOut]:
    fields = body.model_dump(exclude_unset=True)
    character = character_service.update_character(session, character_id, **fields)
    if character is None:
        raise BizException("角色不存在", code=BizCode.NOT_FOUND)
    return Response.success(CharacterOut.model_validate(character), message="更新成功")


@router.delete("/{character_id}", response_model=Response[None])
def delete_character(
    character_id: int, session: Session = Depends(get_session),
) -> Response[None]:
    character = character_service.get_character(session, character_id)
    if character is None:
        raise BizException("角色不存在", code=BizCode.NOT_FOUND)

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
