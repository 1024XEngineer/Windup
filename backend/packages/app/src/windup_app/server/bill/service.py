"""支付与订阅领域服务实现。

实现订单创建、支付回调验签处理、订单查询与超时关闭、订阅到期与批次轮转。
"""

from datetime import datetime, timedelta, timezone
import logging
import secrets
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from windup_app.server.bill.interface import BillService
from windup_app.server.bill.model import (
    Order,
    PaymentEvent,
    Product,
    Subscription,
)
from windup_app.server.bill.provider import (
    ProviderCreateParams,
    get_provider,
)
from windup_app.server.quota.interface import QuotaService
from windup_app.server.quota.model import (
    CreditAccount,
    CreditBatch,
    CreditTransaction,
)
from windup_common.enums.bill import (
    OrderStatus,
    PaymentEventType,
    PaymentProviderType,
    ProductType,
    SubscriptionStatus,
    SubscriptionTier,
)
from windup_common.enums.biz_code import BizCode
from windup_common.enums.quota import BillingMode, CreditReason
from windup_common.exceptions import BizException
from windup_framework.db.redis import get_redis

logger = logging.getLogger("windup.bill.service")


class SqlAlchemyBillService(BillService):
    """基于 SQLAlchemy 的账单与订阅服务实现。"""

    def __init__(self, quota_service: QuotaService | None = None) -> None:
        self._quota_service = quota_service

    @property
    def quota_service(self) -> QuotaService:
        """获取积分领域服务单例。"""
        if self._quota_service is None:
            from windup_app.server.quota.service import service as default_quota_service

            return default_quota_service
        return self._quota_service

    def create_order(
        self,
        session: Session,
        user_id: int,
        product_id: int | None,
        amount_fen: int | None,
        channel: str = "alipay",
    ) -> Order:
        """创建支付订单并生成支付跳转链接。"""
        if product_id is not None:
            product = session.get(Product, product_id)
            if product is None or product.is_active != 1:
                raise BizException("商品不存在或已下架", code=BizCode.BAD_REQUEST)
            order_amount_fen = product.amount_fen
            credits = product.credits
            product_type = product.type
            product_name = product.name
            product_snapshot = {
                "id": product.id,
                "name": product.name,
                "type": product.type,
                "tier": product.tier,
                "amount_fen": product.amount_fen,
                "credits": product.credits,
            }
        else:
            if amount_fen is None:
                raise BizException("缺少充值金额", code=BizCode.BAD_REQUEST)
            if amount_fen < 500:
                raise BizException("自定义充值金额不能低于5元", code=BizCode.BAD_REQUEST)
            if amount_fen % 100 != 0:
                raise BizException("自定义充值金额必须为整元", code=BizCode.BAD_REQUEST)
            order_amount_fen = amount_fen
            credits = (amount_fen + 7) // 8
            product_type = int(ProductType.TOP_UP)
            product_name = f"充值 {amount_fen // 100} 元"
            product_snapshot = {
                "name": product_name,
                "amount_fen": amount_fen,
                "credits": credits,
            }

        now = datetime.now(timezone.utc)
        expire_at = now + timedelta(minutes=15)
        order_no = f"ORD{now.strftime('%Y%m%d%H%M%S')}{secrets.token_hex(4).upper()}"

        order = Order(
            order_no=order_no,
            user_id=user_id,
            product_id=product_id,
            product_type=product_type,
            product_snapshot=product_snapshot,
            amount_fen=order_amount_fen,
            credits=credits,
            channel=channel or "alipay",
            provider=PaymentProviderType.EPAY,
            status=OrderStatus.PENDING,
            expire_at=expire_at,
        )

        # 调用支付通道获取支付链接
        provider = get_provider(PaymentProviderType.EPAY)
        create_params = ProviderCreateParams(
            order_no=order_no,
            amount_fen=order_amount_fen,
            channel=channel or "alipay",
            name=product_name,
        )
        provider_res = provider.create_order(create_params)
        order.pay_url = provider_res.pay_url

        session.add(order)
        session.flush()

        # 写入 Redis 延迟关单 ZSET
        try:
            redis_client = get_redis()
            redis_client.zadd("bill:pending_close", {order.order_no: expire_at.timestamp()})
        except Exception as exc:
            logger.warning("Failed to enqueue order %s to redis: %s", order.order_no, exc)

        return order

    def handle_notify(self, session: Session, payload: dict[str, Any]) -> Order:
        """处理支付回调异步通知。"""
        # 1. 审计落库：无条件持久化原始回调报文
        order_no_raw = payload.get("out_trade_no")
        provider_trade_no_raw = payload.get("trade_no")
        event = PaymentEvent(
            order_no=str(order_no_raw) if order_no_raw else None,
            provider_trade_no=str(provider_trade_no_raw) if provider_trade_no_raw else None,
            event_type=PaymentEventType.PAY_NOTIFY,
            provider=PaymentProviderType.EPAY,
            raw_payload=payload,
        )
        session.add(event)
        session.flush()

        # 2. 验签与结果解析
        provider = get_provider(PaymentProviderType.EPAY)
        notify_res = provider.verify_notify(payload)

        # 3. 行锁查询订单
        order = session.scalar(
            select(Order)
            .where(Order.order_no == notify_res.order_no)
            .with_for_update()
        )
        if order is None:
            raise BizException("订单不存在", code=BizCode.NOT_FOUND)

        if order.amount_fen != notify_res.amount_fen:
            raise BizException("订单金额不匹配", code=BizCode.BAD_REQUEST)

        # 4. 幂等检查
        if order.status == OrderStatus.PAID:
            logger.info("Order %s already paid, skipping duplicate notify", order.order_no)
            return order

        if order.status != OrderStatus.PENDING:
            logger.warning(
                "Order %s status is %s (not PENDING), ignoring notify",
                order.order_no,
                order.status,
            )
            return order

        now = datetime.now(timezone.utc)
        order.status = OrderStatus.PAID
        order.paid_at = now
        order.provider_trade_no = notify_res.provider_trade_no
        session.flush()

        # 5. 积分发放（充值 vs 订阅）
        if order.product_type == ProductType.TOP_UP:
            self._ensure_credit_account(session, order.user_id)
            self.quota_service.credit(
                session,
                user_id=order.user_id,
                amount=order.credits,
                reason=int(CreditReason.TOP_UP),
                ref_id=order.order_no,
            )
        elif order.product_type == ProductType.SUBSCRIPTION:
            tier = (
                order.product_snapshot.get("tier")
                if order.product_snapshot
                else SubscriptionTier.PLUS
            )
            if tier is None:
                tier = SubscriptionTier.PLUS

            # 查询当前用户是否存在有效的活跃订阅
            latest_active = session.scalar(
                select(Subscription)
                .where(
                    Subscription.user_id == order.user_id,
                    Subscription.status.in_(
                        [SubscriptionStatus.ACTIVE, SubscriptionStatus.PENDING_START]
                    ),
                    Subscription.period_end > now,
                )
                .order_by(Subscription.period_end.desc())
                .with_for_update()
            )

            if latest_active is not None:
                sub_status = SubscriptionStatus.PENDING_START
                sub_start = latest_active.period_end
                sub_end = sub_start + timedelta(days=30)
            else:
                sub_status = SubscriptionStatus.ACTIVE
                sub_start = now
                sub_end = now + timedelta(days=30)

            sub = Subscription(
                user_id=order.user_id,
                order_id=order.id,
                tier=tier,
                status=sub_status,
                period_start=sub_start,
                period_end=sub_end,
                credits_granted=order.credits,
            )
            session.add(sub)
            session.flush()

            if sub_status == SubscriptionStatus.ACTIVE:
                self._ensure_credit_account(session, order.user_id)
                self.quota_service.credit(
                    session,
                    user_id=order.user_id,
                    amount=order.credits,
                    reason=int(CreditReason.SUBSCRIPTION),
                    ref_id=f"sub:{sub.id}",
                    expires_at=sub_end,
                )

        return order

    def query_order(self, session: Session, order_no: str) -> Order | None:
        """查询订单详情。"""
        return session.scalar(select(Order).where(Order.order_no == order_no))

    def close_expired_orders(self, session: Session, order_no: str) -> bool:
        """关闭超时未支付的订单。"""
        order = session.scalar(
            select(Order).where(Order.order_no == order_no).with_for_update()
        )
        if order is not None and order.status == OrderStatus.PENDING:
            order.status = OrderStatus.CLOSED
            order.closed_at = datetime.now(timezone.utc)
            session.flush()
            try:
                provider = get_provider(order.provider)
                provider.close_order(order_no)
            except Exception as exc:
                logger.warning("Failed to close order %s on provider: %s", order_no, exc)
            return True
        return False

    def process_expired_subscriptions(self, session: Session) -> int:
        """处理已到期的订阅，清零当期批次并轮转待生效订阅。"""
        now = datetime.now(timezone.utc)
        expired_subs = session.scalars(
            select(Subscription)
            .where(
                Subscription.status == SubscriptionStatus.ACTIVE,
                Subscription.period_end <= now,
            )
            .with_for_update()
        ).all()

        count = 0
        for sub in expired_subs:
            count += 1
            # 1. 查找对应的订阅积分批次并清零可用余额
            batch = session.scalar(
                select(CreditBatch)
                .where(
                    CreditBatch.user_id == sub.user_id,
                    CreditBatch.source_type == int(CreditReason.SUBSCRIPTION),
                    CreditBatch.source_ref == f"sub:{sub.id}",
                    CreditBatch.is_exhausted == 0,
                )
                .with_for_update()
            )
            if batch is not None and batch.remaining > 0:
                expired_amount = batch.remaining
                batch.remaining = 0
                batch.is_exhausted = 1 if batch.frozen == 0 else 0

                # 同步扣减账户可用余额
                account = session.scalar(
                    select(CreditAccount)
                    .where(CreditAccount.user_id == sub.user_id)
                    .with_for_update()
                )
                if account is not None:
                    account.balance -= expired_amount
                    txn = CreditTransaction(
                        user_id=sub.user_id,
                        delta=-expired_amount,
                        reason=int(CreditReason.SUBSCRIPTION_EXPIRE),
                        billing_mode=BillingMode.PREPAID,
                        balance_after=account.balance,
                        ref_id=f"expire:sub:{sub.id}",
                    )
                    session.add(txn)

            sub.status = SubscriptionStatus.EXPIRED

            # 2. 查找是否有排队的待生效订阅 (PENDING_START)
            next_sub = session.scalar(
                select(Subscription)
                .where(
                    Subscription.user_id == sub.user_id,
                    Subscription.status == SubscriptionStatus.PENDING_START,
                )
                .order_by(Subscription.period_start.asc(), Subscription.id.asc())
                .with_for_update()
            )
            if next_sub is not None:
                next_sub.status = SubscriptionStatus.ACTIVE
                self._ensure_credit_account(session, next_sub.user_id)
                self.quota_service.credit(
                    session,
                    user_id=next_sub.user_id,
                    amount=next_sub.credits_granted,
                    reason=int(CreditReason.SUBSCRIPTION),
                    ref_id=f"sub:{next_sub.id}",
                    expires_at=next_sub.period_end,
                )

        session.flush()
        return count

    def _ensure_credit_account(self, session: Session, user_id: int) -> CreditAccount:
        """确保用户积分账户存在。"""
        account = session.scalar(
            select(CreditAccount)
            .where(CreditAccount.user_id == user_id)
            .with_for_update()
        )
        if account is None:
            account = CreditAccount(
                user_id=user_id,
                balance=0,
                frozen=0,
                total_earned=0,
                total_spent=0,
            )
            session.add(account)
            session.flush()
        return account


service = SqlAlchemyBillService()
