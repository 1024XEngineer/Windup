"""积分模块 API。

端点一览
--------
GET  /quota/balance          查询积分余额
GET  /quota/transactions     查询积分流水（分页）
GET  /quota/invite/code      获取我的邀请码
POST /quota/invite/generate  签发新邀请码
"""

from __future__ import annotations

import logging
from datetime import datetime

from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel, ConfigDict
from sqlalchemy.orm import Session

from windup_common.result import ListResponse, Response
from windup_framework.db import get_session

from windup_app.server.quota.service import service

logger = logging.getLogger("windup.quota.api")

router = APIRouter(prefix="/quota", tags=["quota"])


# -- 响应模型 --------------------------------------------------------------


class CreditAccountOut(BaseModel):
    """积分账户响应。"""

    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: int
    balance: int
    frozen: int
    total_earned: int
    total_spent: int
    create_at: datetime
    update_at: datetime


class CreditTransactionOut(BaseModel):
    """积分流水响应。"""

    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: int
    delta: int
    reason: int
    billing_mode: int
    ref_id: str | None
    balance_after: int
    create_at: datetime


class InviteCodeOut(BaseModel):
    """邀请码响应。"""

    code: str
    used_count: int
    expires_at: datetime
    create_at: datetime
    update_at: datetime


# -- 端点 ----------------------------------------------------------------


@router.get("/balance", response_model=Response[CreditAccountOut])
def get_balance(
    request: Request,
    session: Session = Depends(get_session),
) -> Response[CreditAccountOut]:
    """查询当前用户积分余额。"""
    user_id = request.state.current_user.id
    account = service.get_account(session, user_id)
    if account is None:
        from windup_common.enums.biz_code import BizCode
        from windup_common.exceptions import BizException

        raise BizException("积分账户不存在", code=BizCode.NOT_FOUND)
    return Response.success(CreditAccountOut.model_validate(account))


@router.get("/transactions", response_model=ListResponse[CreditTransactionOut])
def list_transactions(
    request: Request,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    session: Session = Depends(get_session),
) -> ListResponse[CreditTransactionOut]:
    """查询积分流水（分页）。"""
    user_id = request.state.current_user.id
    txns, total = service.list_transactions(
        session, user_id, page=page, page_size=page_size
    )
    return ListResponse.success(
        [CreditTransactionOut.model_validate(t) for t in txns],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.get("/invite/code", response_model=Response[InviteCodeOut])
def get_invite_code(
    request: Request,
    session: Session = Depends(get_session),
) -> Response[InviteCodeOut]:
    """获取当前用户未过期邀请码；没有或已过期则签发新行。"""
    view = service.get_invite_code(session, request.state.current_user.id)
    return Response.success(
        InviteCodeOut(
            code=view.code,
            used_count=view.used_count,
            expires_at=view.expires_at,
            create_at=view.create_at,
            update_at=view.update_at,
        )
    )


@router.post("/invite/generate", response_model=Response[InviteCodeOut])
def generate_invite_code(
    request: Request,
    session: Session = Depends(get_session),
) -> Response[InviteCodeOut]:
    """签发新邀请码。旧码立即过期，行保留。"""
    view = service.generate_invite_code(session, request.state.current_user.id)
    return Response.success(
        InviteCodeOut(
            code=view.code,
            used_count=view.used_count,
            expires_at=view.expires_at,
            create_at=view.create_at,
            update_at=view.update_at,
        ),
        message="邀请码已更新",
    )
