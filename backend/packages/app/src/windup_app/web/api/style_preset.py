"""画风预设 API。

GET 给前端选档;POST/PATCH 给管理端维护目录。无独立 admin 角色,与其余业务接口同一登录门。
"""

from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from windup_common.enums.biz_code import BizCode
from windup_common.exceptions import BizException
from windup_common.result import ListResponse, Response
from windup_framework.db import get_session

from windup_app.server.style_preset.service import service

router = APIRouter(prefix="/style-presets", tags=["style-presets"])

_STYLIZE = Literal["pixel", "none"]


class StylePresetCreate(BaseModel):
    code: str = Field(min_length=1, max_length=32)
    name: str = Field(min_length=1, max_length=40)
    kind: str = Field(min_length=1, max_length=32)
    prompt: str = Field(min_length=1)
    sample_url: str = Field(min_length=1)
    stylize: _STYLIZE
    sprite_width: int = Field(ge=32, le=2048)
    sprite_height: int = Field(ge=32, le=2048)
    sort_order: int = 0
    enabled: int = Field(default=1, ge=0, le=1)


class StylePresetUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=40)
    kind: str | None = Field(default=None, min_length=1, max_length=32)
    prompt: str | None = Field(default=None, min_length=1)
    sample_url: str | None = Field(default=None, min_length=1)
    stylize: _STYLIZE | None = None
    sprite_width: int | None = Field(default=None, ge=32, le=2048)
    sprite_height: int | None = Field(default=None, ge=32, le=2048)
    sort_order: int | None = None
    enabled: int | None = Field(default=None, ge=0, le=1)

    @model_validator(mode="before")
    @classmethod
    def reject_explicit_null(cls, data: object) -> object:
        if isinstance(data, dict):
            for key, value in data.items():
                if value is None:
                    raise ValueError(f"{key} 不能为 null")
        return data


class StylePresetOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    code: str
    name: str
    kind: str
    prompt: str
    sample_url: str
    stylize: str
    sprite_width: int
    sprite_height: int
    sort_order: int
    enabled: int
    create_at: datetime
    update_at: datetime


@router.get("", response_model=ListResponse[StylePresetOut])
def list_style_presets(session: Session = Depends(get_session)) -> ListResponse[StylePresetOut]:
    rows = service.list_enabled(session)
    return ListResponse.success(
        [StylePresetOut.model_validate(row) for row in rows],
        total=len(rows),
        page=1,
        page_size=0,
    )


@router.post("", response_model=Response[StylePresetOut])
def create_style_preset(
    body: StylePresetCreate,
    session: Session = Depends(get_session),
) -> Response[StylePresetOut]:
    try:
        preset = service.create(session, **body.model_dump())
    except IntegrityError:
        session.rollback()
        raise BizException("画风编码已存在", code=BizCode.BAD_REQUEST) from None
    return Response.success(StylePresetOut.model_validate(preset), message="创建成功")


@router.patch("/{preset_id}", response_model=Response[StylePresetOut])
def update_style_preset(
    preset_id: int,
    body: StylePresetUpdate,
    session: Session = Depends(get_session),
) -> Response[StylePresetOut]:
    preset = service.get(session, preset_id)
    if preset is None:
        raise BizException("画风预设不存在", code=BizCode.NOT_FOUND)
    fields = body.model_dump(exclude_unset=True)
    if not fields:
        return Response.success(StylePresetOut.model_validate(preset), message="更新成功")
    preset = service.update(session, preset, **fields)
    return Response.success(StylePresetOut.model_validate(preset), message="更新成功")
