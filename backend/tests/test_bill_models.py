from datetime import datetime, timezone

from windup_app.server.bill.interface import BillService
from windup_app.server.bill.model import Order, PaymentEvent, Product, Refund, Subscription
from windup_common.enums.bill import (
    OrderStatus,
    PaymentEventType,
    PaymentProviderType,
    ProductType,
    SubscriptionStatus,
    SubscriptionTier,
)


def test_bill_orm_models():
    prod = Product(
        type=ProductType.TOP_UP,
        name="Test Topup",
        amount_fen=1000,
        credits=100,
        badge="Hot",
    )
    assert prod.sort_order == 0
    assert prod.is_active == 1
    assert prod.extra_meta == {}
    assert prod.__tablename__ == "windup_product"

    order = Order(
        order_no="ORD123456",
        user_id=10,
        product_id=prod.id,
        amount_fen=1000,
        credits=100,
        expire_at=datetime.now(timezone.utc),
    )
    assert order.status == OrderStatus.PENDING
    assert order.channel == "alipay"
    assert order.provider == PaymentProviderType.EPAY
    assert order.__tablename__ == "windup_order"

    event = PaymentEvent(
        order_no="ORD123456",
        provider_trade_no="TRADE123",
        raw_payload={"trade_no": "TRADE123"},
    )
    assert event.event_type == PaymentEventType.PAY_NOTIFY
    assert event.provider == PaymentProviderType.EPAY
    assert event.__tablename__ == "windup_payment_event"

    sub = Subscription(
        user_id=10,
        order_id=1,
        tier=SubscriptionTier.PRO,
        period_start=datetime.now(timezone.utc),
        period_end=datetime.now(timezone.utc),
    )
    assert sub.status == SubscriptionStatus.ACTIVE
    assert sub.credits_granted == 0
    assert sub.__tablename__ == "windup_subscription"

    refund = Refund(
        refund_no="REF123",
        order_no="ORD123456",
        user_id=10,
        amount_fen=1000,
        reason="User request",
    )
    assert refund.status == 0
    assert refund.__tablename__ == "windup_refund"


def test_bill_service_interface_definition():
    assert issubclass(BillService, object)
    abstract_methods = BillService.__abstractmethods__
    expected_methods = {
        "create_order",
        "handle_notify",
        "query_order",
        "close_expired_orders",
        "process_expired_subscriptions",
    }
    assert expected_methods.issubset(abstract_methods)

