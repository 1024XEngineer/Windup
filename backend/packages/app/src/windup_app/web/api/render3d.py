"""母版预检与造型级 3D 资产的端点 —— 前端那道"确认 → 建 → 审"闸的后端一侧。

**本模块不 import ai_engine,也不 import 任何会牵出它的 server 模块**(门禁
"入口层不经 ai_engine 直连"是传递性的)。两件事都经 ``request.app.state`` 上的
运行期注入拿到,与 ``executor`` 走的是同一条路;bootstrap 是唯一的装配点。

代价是这里拿到的是 ``dict`` 而不是带类型的对象,响应模型只能在本文件重写一遍。
这是刻意的:为了标注类型去 import 那边,门禁当场就红。
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from windup_common.enums.biz_code import BizCode
from windup_common.exceptions import BizException
from windup_common.result import Response
from windup_framework.db import get_session

from windup_app.server.character.model import Character, CharacterData
from windup_app.server.character.service import service as character_service
from windup_app.web.api.character import get_character_with_auth

logger = logging.getLogger("windup.render3d.api")

router = APIRouter(prefix="/render3d", tags=["render3d"])


class MasterPrecheckRequest(BaseModel):
    """要预检的母版。只收自家对象存储的 URL —— 服务端替调用方拉任意地址等于把服务器
    当跳板,见 ``orchestrator._fetch``。"""

    image_url: str = Field(..., min_length=1)
    canvas_width: int | None = Field(default=None, gt=0)
    canvas_height: int | None = Field(default=None, gt=0)


def _operations(request: Request):
    """建资产的四个动作。没装配就明说,别让端点抛 AttributeError。"""
    operations = getattr(request.app.state, "render3d_operations", None)
    if operations is None:
        raise BizException("三渲二资产服务未装配", code=BizCode.INTERNAL_ERROR)
    return operations


def _precheck(request: Request):
    precheck = getattr(request.app.state, "precheck_master", None)
    if precheck is None:
        raise BizException("母版预检服务未装配", code=BizCode.INTERNAL_ERROR)
    return precheck


def _asset_key(character_id: int, outfit_id: str) -> str:
    """3D 资产落点的键。**必须带上角色 id**:``outfit_id`` 只在所属角色内唯一,
    而工作流给首个造型的 id 是写死的 ``outfit-default`` —— 只用它当键,全站每个角色
    的默认造型会共用同一个 3D 模型,表现为"别人的角色套着我的模型",且没有任何报错。
    """
    return f"character-{character_id}/{outfit_id}"


def _outfit_or_raise(character: Character, outfit_id: str) -> dict:
    for outfit in (character.character_data or {}).get("outfits", []):
        if outfit.get("id") == outfit_id:
            return outfit
    raise BizException("造型不存在", code=BizCode.NOT_FOUND)


def _master_url_or_raise(outfit: dict) -> str:
    """建资产用的母版就是造型的定妆母版。

    没有它就不能往下走:图生 3D 的入参只有这一张图,拿角色参考图顶替会建出另一个造型
    的模型,而接口照常成功、照常扣积分。
    """
    url = outfit.get("preview_url")
    if not url:
        raise BizException(
            "该造型还没有已确认的定妆母版,先在工作流里确认母版再建 3D 资产",
            code=BizCode.BAD_REQUEST,
        )
    return url


def _sync_model_url(session: Session, character: Character, outfit_id: str, url: str | None) -> None:
    """把建好的模型 URL 回写到 ``character_data``。

    回写发生在**读状态**这一步而不是后台线程里:后台线程没有请求作用域的 session,
    而三渲二那条路线的判据(``Outfit.model_3d_url``)不回写就永远是 None —— 资产建好了
    却依旧显示"该造型暂无绑骨 3D 模型",钱白花。
    """
    if not url:
        return
    data = CharacterData.model_validate(character.character_data or {})
    changed = False
    for outfit in data.outfits:
        if outfit.id == outfit_id and outfit.model_3d_url != url:
            outfit.model_3d_url = url
            changed = True
    if not changed:
        return
    character_service.update_character(session, character.id, character_data=data.model_dump())


@router.post("/master-precheck", response_model=Response[dict])
def precheck_master(
    body: MasterPrecheckRequest,
    request: Request,
) -> Response[dict]:
    """零成本母版预检。**不产生任何按次计费调用**,可以在确认闸上随便调。"""
    canvas = (
        (body.canvas_width, body.canvas_height)
        if body.canvas_width and body.canvas_height
        else None
    )
    try:
        report = _precheck(request)(body.image_url, canvas)
    except ValueError as exc:
        raise BizException(str(exc), code=BizCode.BAD_REQUEST) from exc
    return Response.success(report)


@router.get("/characters/{character_id}/outfits/{outfit_id}", response_model=Response[dict])
def get_outfit_asset(
    character_id: int,
    outfit_id: str,
    request: Request,
    session: Session = Depends(get_session),
) -> Response[dict]:
    user_id = request.state.current_user.id
    character = get_character_with_auth(session, character_id, user_id)
    _outfit_or_raise(character, outfit_id)
    view = _operations(request).view(_asset_key(character_id, outfit_id))
    _sync_model_url(session, character, outfit_id, view["model_3d_url"])
    return Response.success(view)


@router.post("/characters/{character_id}/outfits/{outfit_id}/build", response_model=Response[dict])
def build_outfit_asset(
    character_id: int,
    outfit_id: str,
    request: Request,
    session: Session = Depends(get_session),
) -> Response[dict]:
    """启动图生 3D。**按次计费的触发点**,所以只认用户的显式请求,不在任何自动路径上。"""
    user_id = request.state.current_user.id
    character = get_character_with_auth(session, character_id, user_id)
    outfit = _outfit_or_raise(character, outfit_id)
    operations = _operations(request)
    try:
        return Response.success(
            operations.build(_asset_key(character_id, outfit_id),
                             _master_url_or_raise(outfit)),
            message="已开始生成 3D 模型",
        )
    except ValueError as exc:
        raise BizException(str(exc), code=BizCode.BAD_REQUEST) from exc


@router.post("/characters/{character_id}/outfits/{outfit_id}/approve", response_model=Response[dict])
def approve_outfit_asset(
    character_id: int,
    outfit_id: str,
    request: Request,
    session: Session = Depends(get_session),
) -> Response[dict]:
    """人看过模型并点头 → 继续绑骨。**唯一的放行入口**,没有超时自动放行。"""
    user_id = request.state.current_user.id
    character = get_character_with_auth(session, character_id, user_id)
    outfit = _outfit_or_raise(character, outfit_id)
    try:
        view = _operations(request).approve(
            _asset_key(character_id, outfit_id), _master_url_or_raise(outfit)
        )
    except ValueError as exc:
        raise BizException(str(exc), code=BizCode.BAD_REQUEST) from exc
    return Response.success(view, message="已放行,开始绑骨")


@router.post("/characters/{character_id}/outfits/{outfit_id}/discard", response_model=Response[dict])
def discard_outfit_asset(
    character_id: int,
    outfit_id: str,
    request: Request,
    session: Session = Depends(get_session),
) -> Response[dict]:
    """模型不合格 → 丢弃重来。混元的模型改不动,这是唯一的补救。"""
    user_id = request.state.current_user.id
    character = get_character_with_auth(session, character_id, user_id)
    _outfit_or_raise(character, outfit_id)
    try:
        view = _operations(request).discard(_asset_key(character_id, outfit_id))
    except ValueError as exc:
        raise BizException(str(exc), code=BizCode.BAD_REQUEST) from exc
    return Response.success(view, message="已丢弃待审模型")
