"""支付账单 API。

端点一览
--------
GET  /bill/products          查询在售商品
POST /bill/orders            创建订单
GET  /bill/orders            查询历史订单
GET  /bill/orders/{order_no} 查询订单详情
POST /bill/orders/{order_no}/close 手动关闭待支付订单
GET  /bill/subscription      查询我的订阅状态
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, Query, Request, Path
from pydantic import BaseModel, ConfigDict
from sqlalchemy.orm import Session
from sqlalchemy import select, func

from windup_common.enums.biz_code import BizCode
from windup_common.exceptions import BizException
from windup_common.result import ListResponse, Response
from windup_framework.db import get_session

from windup_app.server.bill.service import service as bill_service
from windup_app.server.bill.model import Product, Order, Subscription
from windup_app.server.quota.service import service as quota_service

logger = logging.getLogger("windup.bill.api")

router = APIRouter(prefix="/bill", tags=["bill"])

# -- 响应与请求模型 --------------------------------------------------------

class ProductOut(BaseModel):
    id: int
    type: int
    tier: int | None
    name: str
    description: str | None
    amount_fen: int
    credits: int
    original_amount_fen: int | None
    badge: str | None
    sort_order: int
    extra_meta: dict[str, Any]

    model_config = ConfigDict(from_attributes=True)


class CreateOrderIn(BaseModel):
    product_id: int | None = None
    amount_fen: int | None = None
    channel: str = "alipay"


class OrderOut(BaseModel):
    order_no: str
    product_id: int | None
    product_type: int
    product_snapshot: dict[str, Any]
    amount_fen: int
    credits: int
    channel: str
    provider: int
    status: int
    pay_url: str | None
    expire_at: datetime
    paid_at: datetime | None
    closed_at: datetime | None
    create_at: datetime

    model_config = ConfigDict(from_attributes=True)


class SubscriptionOut(BaseModel):
    tier: int
    status: int
    period_start: datetime
    period_end: datetime

    model_config = ConfigDict(from_attributes=True)


class SubscriptionStatusOut(BaseModel):
    active_subscription: SubscriptionOut | None = None
    next_subscription: SubscriptionOut | None = None
    perpetual_credits: int
    expiring_credits: int

# -- 端点 ----------------------------------------------------------------

@router.get("/products", response_model=ListResponse[ProductOut])
def list_products(
    session: Session = Depends(get_session),
) -> ListResponse[ProductOut]:
    """查询当前在售商品，按 sort_order 升序。"""
    rows = session.scalars(
        select(Product)
        .where(Product.is_active == 1)
        .order_by(Product.sort_order.asc(), Product.id.asc())
    ).all()

    return ListResponse.success([ProductOut.model_validate(r) for r in rows])


@router.post("/orders", response_model=Response[OrderOut])
def create_order(
    payload: CreateOrderIn,
    request: Request,
    session: Session = Depends(get_session),
) -> Response[OrderOut]:
    """创建充值或订阅订单。"""
    user_id = request.state.current_user.id

    if payload.product_id is None and payload.amount_fen is None:
        raise BizException("必须提供 product_id 或自定义 amount_fen", code=BizCode.BAD_REQUEST)

    order = bill_service.create_order(
        session,
        user_id=user_id,
        product_id=payload.product_id,
        amount_fen=payload.amount_fen,
        channel=payload.channel,
    )

    return Response.success(OrderOut.model_validate(order))


@router.get("/orders", response_model=ListResponse[OrderOut])
def list_orders(
    request: Request,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    status: int | None = Query(None),
    session: Session = Depends(get_session),
) -> ListResponse[OrderOut]:
    """查询当前用户的订单列表。"""
    user_id = request.state.current_user.id

    conditions = [Order.user_id == user_id]
    if status is not None:
        conditions.append(Order.status == status)

    total = session.scalar(
        select(func.count())
        .select_from(Order)
        .where(*conditions)
    )

    rows = session.scalars(
        select(Order)
        .where(*conditions)
        .order_by(Order.create_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).all()

    return ListResponse.success(
        [OrderOut.model_validate(r) for r in rows],
        total=total or 0,
        page=page,
        page_size=page_size
    )


@router.get("/orders/{order_no}", response_model=Response[OrderOut])
def get_order(
    order_no: str = Path(...),
    request: Request = None,
    session: Session = Depends(get_session),
) -> Response[OrderOut]:
    """查询订单详情（回调丢失时向上游补偿查询）。"""
    user_id = request.state.current_user.id

    order = bill_service.query_order(session, order_no)

    if order is None or order.user_id != user_id:
        raise BizException("订单不存在", code=BizCode.NOT_FOUND)

    return Response.success(OrderOut.model_validate(order))


@router.post("/orders/{order_no}/close", response_model=Response[None])
def close_order(
    order_no: str = Path(...),
    request: Request = None,
    session: Session = Depends(get_session),
) -> Response[None]:
    """手动关闭待支付的订单。

    service 内部先向上游核实支付结果：上游未支付才置 CLOSED，已支付则补发货，
    结果不确定时返回 "retry"。
    """
    user_id = request.state.current_user.id

    order = session.scalar(
        select(Order).where(Order.order_no == order_no)
    )

    if order is None or order.user_id != user_id:
        raise BizException("订单不存在", code=BizCode.NOT_FOUND)

    from windup_common.enums.bill import OrderStatus
    if order.status != OrderStatus.PENDING:
        raise BizException("只能关闭待支付的订单", code=BizCode.BAD_REQUEST)

    result = bill_service.close_expired_orders(session, order_no)
    if result == "retry":
        raise BizException("上游关单结果未确认，请稍后重试", code=BizCode.BAD_REQUEST)

    return Response.success(None)


@router.get("/subscription", response_model=Response[SubscriptionStatusOut])
def get_subscription_status(
    request: Request,
    session: Session = Depends(get_session),
) -> Response[SubscriptionStatusOut]:
    """查询用户的订阅状态与积分余额详情。"""
    user_id = request.state.current_user.id

    now = datetime.now(timezone.utc)
    from windup_common.enums.bill import SubscriptionStatus

    active = session.scalar(
        select(Subscription)
        .where(
            Subscription.user_id == user_id,
            Subscription.status == SubscriptionStatus.ACTIVE,
            Subscription.period_start <= now,
            Subscription.period_end > now
        )
        .order_by(Subscription.period_end.desc())
    )

    next_sub = session.scalar(
        select(Subscription)
        .where(
            Subscription.user_id == user_id,
            Subscription.status == SubscriptionStatus.PENDING_START,
        )
        .order_by(Subscription.period_start.asc())
    )

    batch_info = quota_service.get_active_batches(session, user_id)

    return Response.success(SubscriptionStatusOut(
        active_subscription=SubscriptionOut.model_validate(active) if active else None,
        next_subscription=SubscriptionOut.model_validate(next_sub) if next_sub else None,
        perpetual_credits=batch_info["perpetual_credits"],
        expiring_credits=batch_info["expiring_credits"]
    ))