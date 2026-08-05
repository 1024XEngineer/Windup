"""Playtest 核验记录 API。"""

from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from windup_common.enums.biz_code import BizCode
from windup_common.exceptions import BizException
from windup_common.result import Response
from windup_framework.db import get_session

from windup_app.server.character.service import service as character_service
from windup_app.server.playtest_inspection.service import service

router = APIRouter(prefix="/playtest-inspections", tags=["playtest"])

InspectionStatus = Literal["passed", "issues_found"]


class PlaytestInspectionSave(BaseModel):
    """保存动作当前核验结论的请求。"""

    character_id: int = Field(gt=0)
    outfit_id: str = Field(min_length=1, max_length=128)
    action_id: str = Field(min_length=1, max_length=128)
    status: InspectionStatus


class PlaytestInspectionOut(PlaytestInspectionSave):
    """动作当前核验结论。"""

    model_config = ConfigDict(from_attributes=True)

    id: int
    create_at: datetime
    update_at: datetime


def _require_action(
    session: Session, *, character_id: int, outfit_id: str, action_id: str
) -> None:
    character = character_service.get_character(session, character_id)
    if character is None:
        raise BizException("角色不存在", code=BizCode.NOT_FOUND)

    outfits = (character.character_data or {}).get("outfits", [])
    outfit = next((item for item in outfits if item.get("id") == outfit_id), None)
    if outfit is None:
        raise BizException("造型不存在", code=BizCode.NOT_FOUND)
    if not any(item.get("id") == action_id for item in outfit.get("actions", [])):
        raise BizException("动作不存在", code=BizCode.NOT_FOUND)


@router.get("", response_model=Response[PlaytestInspectionOut])
def get_playtest_inspection(
    character_id: int = Query(..., gt=0),
    outfit_id: str = Query(..., min_length=1, max_length=128),
    action_id: str = Query(..., min_length=1, max_length=128),
    session: Session = Depends(get_session),
) -> Response[PlaytestInspectionOut]:
    inspection = service.get_inspection(
        session,
        character_id=character_id,
        outfit_id=outfit_id,
        action_id=action_id,
    )
    if inspection is None:
        raise BizException("尚未核验", code=BizCode.NOT_FOUND)
    return Response.success(PlaytestInspectionOut.model_validate(inspection))


@router.post("", response_model=Response[PlaytestInspectionOut])
def save_playtest_inspection(
    body: PlaytestInspectionSave,
    session: Session = Depends(get_session),
) -> Response[PlaytestInspectionOut]:
    _require_action(
        session,
        character_id=body.character_id,
        outfit_id=body.outfit_id,
        action_id=body.action_id,
    )
    inspection = service.save_inspection(session, **body.model_dump())
    return Response.success(
        PlaytestInspectionOut.model_validate(inspection), message="核验已保存"
    )
