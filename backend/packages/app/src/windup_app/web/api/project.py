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

from windup_app.server.character.cleanup import extract_object_keys
from windup_app.server.character.service import service as character_service
from windup_app.server.media.service import service as media_service
from windup_app.server.project.interface import UNSET
from windup_app.server.project.naming import numbered_project_name, resolve_project_name
from windup_app.server.project.service import service

logger = logging.getLogger("windup.project.api")

router = APIRouter(prefix="/projects", tags=["projects"])


def _legacy_style_or_none(value: object) -> ArtStyle | str | None:
    """画风枚举化之前发的是自由文本;直接拒会让还没换下拉的客户端改不了项目。

    认不出的取值**原样留着**:归到 ``UNSPECIFIED`` 会把用户已有的画风约束静默抹掉。
    等所有入口都改发枚举码之后,这条兼容连同 ``str`` 分支一起收紧。
    """
    if value is None or isinstance(value, ArtStyle):
        return value
    if not isinstance(value, str):
        return value
    try:
        return ArtStyle(value.strip())
    except ValueError:
        return ArtStyle.PIXEL if ArtStyle.from_stored(value) is ArtStyle.PIXEL else value


def _stored_style(style: ArtStyle | str | None) -> str | None:
    """``UNSPECIFIED`` 落库存 NULL —— 现有前端把这一列原样显示,写字面量会让它显示出来。

    非枚举的存量自由文本原样落库,交给 ``ArtStyle.phrase_from_stored`` 在生成时读回。
    """
    if style is None or style is ArtStyle.UNSPECIFIED:
        return None
    return style.value if isinstance(style, ArtStyle) else style.strip() or None


class ProjectCreate(BaseModel):
    """创建项目请求。"""

    workflow_id: int | None = None
    project_name: str | None = Field(default=None, min_length=1, max_length=20)
    name_context: str | None = None
    character_perspective: int = Field(ge=1, le=3)
    directional_movement: int = Field(ge=1, le=3)
    sprite_width: int = Field(ge=32, le=2048)
    sprite_height: int = Field(ge=32, le=2048)
    game_style: ArtStyle | str = ArtStyle.UNSPECIFIED
    sprite_sample_url: str | None = None

    @field_validator("game_style", mode="before")
    @classmethod
    def _accept_legacy_free_text(cls, value: object) -> ArtStyle | str:
        got = _legacy_style_or_none(value)
        return ArtStyle.UNSPECIFIED if got is None else got


class ProjectPatch(BaseModel):
    """改项目请求;只改传上来的那些字段。"""

    project_name: str | None = Field(default=None, min_length=1, max_length=20)
    game_style: ArtStyle | str | None = None

    _accept_legacy = field_validator("game_style", mode="before")(
        _legacy_style_or_none
    )

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
    game_style: ArtStyle | str
    sprite_sample_url: str | None
    create_at: datetime
    update_at: datetime

    @field_validator("game_style", mode="before")
    @classmethod
    def _normalize_style(cls, value: object) -> ArtStyle | str:
        """库里既有枚举码也有存量自由文本。

        认得出的归一成枚举码,认不出的**原样交出去** —— 压成 ``UNSPECIFIED`` 会让接口
        与生成时实际用的画风对不上:库里存着「中世纪厚涂」、提示词里也用着它,而接口说
        这个项目没设画风。
        """
        if not isinstance(value, str) or not value.strip():
            return ArtStyle.UNSPECIFIED
        text = value.strip()
        try:
            return ArtStyle(text)
        except ValueError:
            return ArtStyle.PIXEL if ArtStyle.from_stored(text) is ArtStyle.PIXEL else text


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
    automatic_name = not (body.project_name or "").strip()
    base_name = resolve_project_name(body.project_name, body.name_context, service._namer)
    fields = body.model_dump(exclude={"project_name", "name_context"})
    fields["game_style"] = _stored_style(body.game_style)

    for sequence in range(1, 101 if automatic_name else 2):
        project_name = numbered_project_name(base_name, sequence)
        if service.project_name_exists(
            session, user_id=user_id, project_name=project_name
        ):
            if automatic_name:
                continue
            logger.warning(
                "[WINDUP] 创建拒绝-名称重复 | user_id=%s project_name=%s",
                user_id,
                project_name,
            )
            raise BizException("项目名称已存在", code=BizCode.BAD_REQUEST)
        try:
            project = service.create_project(
                session, user_id=user_id, project_name=project_name, **fields
            )
            return Response.success(ProjectOut.model_validate(project), message="创建成功")
        except IntegrityError:
            logger.warning(
                "[WINDUP] 创建并发重名 | user_id=%s project_name=%s",
                user_id,
                project_name,
            )
            session.rollback()
            if not automatic_name:
                break
    raise BizException("项目名称已存在", code=BizCode.BAD_REQUEST)


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
            game_style=(
                UNSET if body.game_style is None else _stored_style(body.game_style)
            ),
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
    characters = []
    page = 1
    while True:
        items, total = character_service.list_characters(
            session,
            project_id=project_id,
            page=page,
            page_size=100,
        )
        characters.extend(items)
        if len(characters) >= total:
            break
        page += 1

    object_keys = list(
        dict.fromkeys(
            key for character in characters for key in extract_object_keys(character)
        )
    )
    try:
        for character in characters:
            character_service.delete_character(session, character.id)
        service.delete_project(session, project_id)
    except IntegrityError:
        session.rollback()
        raise BizException(
            "项目下仍有角色，无法删除", code=BizCode.BAD_REQUEST
        ) from None
    for key in object_keys:
        try:
            media_service.delete(key)
        except Exception:
            logger.warning("[WINDUP] 媒体清理失败(已跳过) | key=%s", key, exc_info=True)
    return Response.success(None, message="删除成功")
