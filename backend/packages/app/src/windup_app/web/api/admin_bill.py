"""管理员账单操作 API。"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

from windup_common.result import Response
from windup_framework.db import get_session
from windup_app.server.bill.service import service as bill_service

logger = logging.getLogger("windup.admin_bill.api")

router = APIRouter(prefix="/admin/bill", tags=["admin_bill"])


class AdminRefundIn(BaseModel):
    order_no: str
    amount_fen: int | None = None
    reason: str | None = None


@router.post("/refunds", response_model=Response[dict[str, Any]])
def admin_refund(
    payload: AdminRefundIn,
    request: Request,
    session: Session = Depends(get_session),
) -> Response[dict[str, Any]]:
    """管理员手动发起退款（开发占位）。"""
    # user_id = request.state.current_user.id

    # 这里应有角色权限检查。此处假设 AuthMiddleware + RBAC 后续拦截
    # if not is_admin(user_id):
    #     raise BizException("无权操作", code=BizCode.FORBIDDEN)

    refund_no = bill_service.process_refund(
        session,
        order_no=payload.order_no,
        refund_amount_fen=payload.amount_fen,
        reason=payload.reason or "管理员手动发起",
    )

    return Response.success({"refund_no": refund_no})