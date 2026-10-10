"""支付与账单领域模型。

与数据库表一一对应，字段名与列名保持一致。

ORM 模型
--------

::

    windup_product          商品配置表（充值快捷档位与订阅套餐）
    windup_order            订单表（充值与订阅支付记录）
    windup_payment_event    支付回调事件审计表
    windup_subscription     用户会员订阅记录表
    windup_refund           退款记录表
"""

from datetime import datetime, timezone

from sqlalchemy import (
    BigInteger,
    DateTime,
    Index,
    Integer,
    JSON,
    SmallInteger,
    String,
    Text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from windup_common.enums.bill import (
    OrderStatus,
    PaymentEventType,
    PaymentProviderType,
    ProductType,
    SubscriptionStatus,
)
from windup_framework.db import Base


class Product(Base):
    """商品配置表。

    存储充值快捷商品档位及月度订阅配置 (PLUS/PRO/MAX)。
    """

    __tablename__ = "windup_product"

    id: Mapped[int] = mapped_column(
        BigInteger().with_variant(Integer, "sqlite"),
        primary_key=True,
        autoincrement=True,
    )
    type: Mapped[int] = mapped_column(
        SmallInteger,
        nullable=False,
        default=ProductType.TOP_UP,
    )  # 1=TOP_UP, 2=SUBSCRIPTION
    tier: Mapped[int | None] = mapped_column(
        SmallInteger,
        nullable=True,
    )  # 订阅档位: 1=PLUS, 2=PRO, 3=MAX (充值商品为 NULL)
    name: Mapped[str] = mapped_column(
        String(64),
        nullable=False,
    )
    description: Mapped[str | None] = mapped_column(
        String(255),
        nullable=True,
    )
    amount_fen: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
    )  # 金额（分）
    credits: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
    )  # 应赠送/获得积分
    original_amount_fen: Mapped[int | None] = mapped_column(
        Integer,
        nullable=True,
    )  # 原价（分），用于前端划线价展示
    badge: Mapped[str | None] = mapped_column(
        String(32),
        nullable=True,
    )  # 促销标签如 "热卖", "9.4折"
    sort_order: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
    )
    is_active: Mapped[int] = mapped_column(
        SmallInteger,
        nullable=False,
        default=1,
    )  # 1=上架, 0=下架
    extra_meta: Mapped[dict] = mapped_column(
        JSON().with_variant(JSONB, "postgresql"),
        nullable=False,
        default=dict,
    )
    create_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )
    update_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    def __init__(self, *args, **kwargs):
        kwargs.setdefault("sort_order", 0)
        kwargs.setdefault("is_active", 1)
        kwargs.setdefault("extra_meta", {})
        super().__init__(*args, **kwargs)


class Order(Base):
    """订单表。

    记录商户订单号、实付金额、应得积分、商品快照、支付渠道及状态。
    """

    __tablename__ = "windup_order"
    __table_args__ = (
        Index("ix_order_user_status", "user_id", "status"),
    )

    id: Mapped[int] = mapped_column(
        BigInteger().with_variant(Integer, "sqlite"),
        primary_key=True,
        autoincrement=True,
    )
    order_no: Mapped[str] = mapped_column(
        String(64),
        unique=True,
        index=True,
        nullable=False,
    )  # 商户系统内部唯一订单号
    user_id: Mapped[int] = mapped_column(
        BigInteger().with_variant(Integer, "sqlite"),
        nullable=False,
        index=True,
    )
    product_id: Mapped[int | None] = mapped_column(
        BigInteger().with_variant(Integer, "sqlite"),
        nullable=True,
    )  # 关联商品ID，自定义金额充值时可为空
    product_type: Mapped[int] = mapped_column(
        SmallInteger,
        nullable=False,
        default=ProductType.TOP_UP,
    )  # 1=TOP_UP, 2=SUBSCRIPTION
    product_snapshot: Mapped[dict] = mapped_column(
        JSON().with_variant(JSONB, "postgresql"),
        nullable=False,
        default=dict,
    )  # 下单时商品快照 (name, amount_fen, credits, tier 等)
    amount_fen: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
    )  # 订单实付金额（分）
    credits: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
    )  # 应赠送/获得积分
    channel: Mapped[str] = mapped_column(
        String(32),
        nullable=False,
        default="alipay",
    )  # 支付方式: "alipay", "wxpay" 等
    provider: Mapped[int] = mapped_column(
        SmallInteger,
        nullable=False,
        default=PaymentProviderType.EPAY,
    )  # 1=EPAY, 2=STRIPE
    provider_trade_no: Mapped[str | None] = mapped_column(
        String(128),
        nullable=True,
        index=True,
    )  # 支付平台交易号
    status: Mapped[int] = mapped_column(
        SmallInteger,
        nullable=False,
        default=OrderStatus.PENDING,
    )  # 0=PENDING, 1=PAID, 2=CLOSED, 3=REFUNDING, 4=REFUNDED
    pay_url: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
    )  # 支付跳转 URL 或二维码串
    expire_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
    )  # 订单超时关闭时间（默认下单后 15 分钟）
    paid_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )  # 支付完成时间
    closed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )  # 订单关闭时间
    create_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )
    update_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    def __init__(self, *args, **kwargs):
        kwargs.setdefault("status", OrderStatus.PENDING)
        kwargs.setdefault("product_type", ProductType.TOP_UP)
        kwargs.setdefault("product_snapshot", {})
        kwargs.setdefault("channel", "alipay")
        kwargs.setdefault("provider", PaymentProviderType.EPAY)
        super().__init__(*args, **kwargs)


class PaymentEvent(Base):
    """支付通知事件表。

    无条件持久化外部支付平台的回调与通知原始报文，用于审计对账。
    """

    __tablename__ = "windup_payment_event"

    id: Mapped[int] = mapped_column(
        BigInteger().with_variant(Integer, "sqlite"),
        primary_key=True,
        autoincrement=True,
    )
    order_no: Mapped[str | None] = mapped_column(
        String(64),
        nullable=True,
        index=True,
    )
    provider_trade_no: Mapped[str | None] = mapped_column(
        String(128),
        nullable=True,
        index=True,
    )
    event_type: Mapped[int] = mapped_column(
        SmallInteger,
        nullable=False,
        default=PaymentEventType.PAY_NOTIFY,
    )  # 1=PAY_NOTIFY, 2=REFUND_NOTIFY
    provider: Mapped[int] = mapped_column(
        SmallInteger,
        nullable=False,
        default=PaymentProviderType.EPAY,
    )  # 1=EPAY, 2=STRIPE
    raw_payload: Mapped[dict] = mapped_column(
        JSON().with_variant(JSONB, "postgresql"),
        nullable=False,
        default=dict,
    )  # 原始报文
    create_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )

    def __init__(self, *args, **kwargs):
        kwargs.setdefault("event_type", PaymentEventType.PAY_NOTIFY)
        kwargs.setdefault("provider", PaymentProviderType.EPAY)
        kwargs.setdefault("raw_payload", {})
        super().__init__(*args, **kwargs)


class Subscription(Base):
    """订阅会员表。

    记录用户的订阅等级 (tier) 及账期起止时间 (period_start, period_end)。
    """

    __tablename__ = "windup_subscription"
    __table_args__ = (
        Index("ix_subscription_user_status", "user_id", "status"),
    )

    id: Mapped[int] = mapped_column(
        BigInteger().with_variant(Integer, "sqlite"),
        primary_key=True,
        autoincrement=True,
    )
    user_id: Mapped[int] = mapped_column(
        BigInteger().with_variant(Integer, "sqlite"),
        nullable=False,
        index=True,
    )
    order_id: Mapped[int] = mapped_column(
        BigInteger().with_variant(Integer, "sqlite"),
        nullable=False,
    )  # 关联支付订单ID
    tier: Mapped[int] = mapped_column(
        SmallInteger,
        nullable=False,
    )  # 1=PLUS, 2=PRO, 3=MAX
    status: Mapped[int] = mapped_column(
        SmallInteger,
        nullable=False,
        default=SubscriptionStatus.ACTIVE,
    )  # 0=PENDING_START, 1=ACTIVE, 2=EXPIRED
    period_start: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
    )  # 本期起算时间
    period_end: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
    )  # 本期截至时间
    credits_granted: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
    )  # 本期发放积分
    create_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )
    update_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    def __init__(self, *args, **kwargs):
        kwargs.setdefault("status", SubscriptionStatus.ACTIVE)
        kwargs.setdefault("credits_granted", 0)
        super().__init__(*args, **kwargs)


class Refund(Base):
    """退款表。

    记录退款申请与状态。
    """

    __tablename__ = "windup_refund"

    id: Mapped[int] = mapped_column(
        BigInteger().with_variant(Integer, "sqlite"),
        primary_key=True,
        autoincrement=True,
    )
    refund_no: Mapped[str] = mapped_column(
        String(64),
        unique=True,
        index=True,
        nullable=False,
    )  # 退款编号
    order_no: Mapped[str] = mapped_column(
        String(64),
        nullable=False,
        index=True,
    )  # 原订单号
    user_id: Mapped[int] = mapped_column(
        BigInteger().with_variant(Integer, "sqlite"),
        nullable=False,
        index=True,
    )
    amount_fen: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
    )  # 退款金额（分）
    reason: Mapped[str | None] = mapped_column(
        String(255),
        nullable=True,
    )  # 退款原因
    status: Mapped[int] = mapped_column(
        SmallInteger,
        nullable=False,
        default=0,
    )  # 0=PENDING, 1=SUCCESS, 2=FAILED
    provider_refund_no: Mapped[str | None] = mapped_column(
        String(128),
        nullable=True,
    )  # 支付通道退款流水号
    create_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )
    update_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    def __init__(self, *args, **kwargs):
        kwargs.setdefault("status", 0)
        super().__init__(*args, **kwargs)
