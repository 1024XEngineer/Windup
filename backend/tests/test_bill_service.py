from datetime import datetime, timezone
from unittest.mock import MagicMock, patch
import pytest
from sqlalchemy import select

from windup_app.server.bill.model import (
    PaymentEvent,
    Product,
    Subscription,
)
from windup_app.server.bill.provider import get_provider
from windup_app.server.bill.service import service as bill_service
from windup_app.server.quota.model import CreditAccount, CreditBatch
from windup_common.enums.bill import (
    OrderStatus,
    PaymentEventType,
    PaymentProviderType,
    ProductType,
    SubscriptionStatus,
    SubscriptionTier,
)
from windup_common.enums.quota import CreditReason
from windup_common.exceptions import BizException


def test_create_custom_order(db_session):
    # Should fail if amount is below 500 or not multiple of 100
    with pytest.raises(Exception):
        bill_service.create_order(db_session, 1, None, 400, "alipay")


def test_create_custom_order_validation(db_session):
    # Should fail if amount is below 500
    with pytest.raises(BizException, match="不能低于5元"):
        bill_service.create_order(db_session, user_id=1, product_id=None, amount_fen=400, channel="alipay")

    # Should fail if amount is not multiple of 100
    with pytest.raises(BizException, match="必须为整元"):
        bill_service.create_order(db_session, user_id=1, product_id=None, amount_fen=550, channel="alipay")

    # Should fail if amount is None when product_id is None
    with pytest.raises(BizException, match="缺少充值金额"):
        bill_service.create_order(db_session, user_id=1, product_id=None, amount_fen=None, channel="alipay")

    # Should fail if product does not exist
    with pytest.raises(BizException, match="商品不存在或已下架"):
        bill_service.create_order(db_session, user_id=1, product_id=99999, amount_fen=None, channel="alipay")


def test_create_custom_order_success(db_session):
    mock_redis = MagicMock()
    with patch("windup_app.server.bill.service.get_redis", return_value=mock_redis):
        # 1000 fen = 10 yuan -> credits = (1000 + 7) // 8 = 125
        order = bill_service.create_order(
            db_session, user_id=1, product_id=None, amount_fen=1000, channel="alipay"
        )
        assert order.id is not None
        assert order.user_id == 1
        assert order.amount_fen == 1000
        assert order.credits == 125
        assert order.product_type == ProductType.TOP_UP
        assert order.status == OrderStatus.PENDING
        assert order.channel == "alipay"
        assert order.provider == PaymentProviderType.EPAY
        assert order.pay_url is not None
        assert "submit.php?" in order.pay_url
        assert order.expire_at > datetime.now(timezone.utc)

        # 验证写入 Redis 延迟关单队列
        mock_redis.zadd.assert_called_once()
        args, kwargs = mock_redis.zadd.call_args
        assert args[0] == "bill:pending_close"
        assert order.order_no in args[1]


def test_create_product_order_success(db_session):
    prod = Product(
        type=ProductType.TOP_UP,
        name="Standard Credits",
        amount_fen=4800,
        credits=600,
        is_active=1,
    )
    db_session.add(prod)
    db_session.flush()

    mock_redis = MagicMock()
    with patch("windup_app.server.bill.service.get_redis", return_value=mock_redis):
        order = bill_service.create_order(
            db_session, user_id=2, product_id=prod.id, amount_fen=None, channel="wxpay"
        )
        assert order.amount_fen == 4800
        assert order.credits == 600
        assert order.product_id == prod.id
        assert order.product_type == ProductType.TOP_UP
        assert order.channel == "wxpay"
        assert order.product_snapshot["name"] == "Standard Credits"


def test_handle_notify_top_up(db_session):
    # 1. 创建待支付订单
    mock_redis = MagicMock()
    with patch("windup_app.server.bill.service.get_redis", return_value=mock_redis):
        order = bill_service.create_order(
            db_session, user_id=10, product_id=None, amount_fen=1000, channel="alipay"
        )

    provider = get_provider(PaymentProviderType.EPAY)
    notify_payload = {
        "pid": getattr(provider, "pid", 1000),
        "trade_no": "EPAY_TRADE_1001",
        "out_trade_no": order.order_no,
        "type": "alipay",
        "name": "Test Order",
        "money": "10.00",
        "trade_status": "TRADE_SUCCESS",
    }
    sign = provider.sign_params(notify_payload, getattr(provider, "key", ""))
    notify_payload["sign"] = sign
    notify_payload["sign_type"] = "MD5"

    # 2. 处理支付回调
    paid_order = bill_service.handle_notify(db_session, notify_payload)
    assert paid_order.status == OrderStatus.PAID
    assert paid_order.paid_at is not None
    assert paid_order.provider_trade_no == "EPAY_TRADE_1001"

    # 3. 验证审计事件保存
    event = db_session.scalar(
        select(PaymentEvent).where(PaymentEvent.order_no == order.order_no)
    )
    assert event is not None
    assert event.event_type == PaymentEventType.PAY_NOTIFY

    # 4. 验证积分发放
    account = db_session.scalar(
        select(CreditAccount).where(CreditAccount.user_id == 10)
    )
    assert account is not None
    assert account.balance == 125
    assert account.total_earned == 125

    batch = db_session.scalar(
        select(CreditBatch).where(CreditBatch.user_id == 10)
    )
    assert batch is not None
    assert batch.source_type == int(CreditReason.TOP_UP)
    assert batch.remaining == 125
    assert batch.expires_at is None

    # 5. 验证回调幂等性：重复回调不重复入账
    paid_order_again = bill_service.handle_notify(db_session, notify_payload)
    assert paid_order_again.status == OrderStatus.PAID
    account_again = db_session.scalar(
        select(CreditAccount).where(CreditAccount.user_id == 10)
    )
    assert account_again.balance == 125


def test_handle_notify_subscription_and_queue(db_session):
    prod = Product(
        type=ProductType.SUBSCRIPTION,
        tier=SubscriptionTier.PRO,
        name="Pro Subscription",
        amount_fen=3900,
        credits=500,
        is_active=1,
    )
    db_session.add(prod)
    db_session.flush()

    mock_redis = MagicMock()
    with patch("windup_app.server.bill.service.get_redis", return_value=mock_redis):
        order1 = bill_service.create_order(
            db_session, user_id=20, product_id=prod.id, amount_fen=None, channel="alipay"
        )

    provider = get_provider(PaymentProviderType.EPAY)
    payload1 = {
        "pid": getattr(provider, "pid", 1000),
        "trade_no": "EPAY_SUB_001",
        "out_trade_no": order1.order_no,
        "type": "alipay",
        "name": "Pro Sub",
        "money": "39.00",
        "trade_status": "TRADE_SUCCESS",
    }
    payload1["sign"] = provider.sign_params(payload1, getattr(provider, "key", ""))
    payload1["sign_type"] = "MD5"

    bill_service.handle_notify(db_session, payload1)

    # 验证首期订阅激活
    sub1 = db_session.scalar(
        select(Subscription).where(Subscription.user_id == 20)
    )
    assert sub1 is not None
    assert sub1.status == SubscriptionStatus.ACTIVE
    assert sub1.tier == SubscriptionTier.PRO
    assert sub1.credits_granted == 500

    batch1 = db_session.scalar(
        select(CreditBatch).where(
            CreditBatch.user_id == 20,
            CreditBatch.source_type == int(CreditReason.SUBSCRIPTION),
        )
    )
    assert batch1 is not None
    assert batch1.remaining == 500
    assert batch1.expires_at == sub1.period_end

    # 用户在当前订阅生效期内续购第二期
    with patch("windup_app.server.bill.service.get_redis", return_value=mock_redis):
        order2 = bill_service.create_order(
            db_session, user_id=20, product_id=prod.id, amount_fen=None, channel="alipay"
        )

    payload2 = {
        "pid": getattr(provider, "pid", 1000),
        "trade_no": "EPAY_SUB_002",
        "out_trade_no": order2.order_no,
        "type": "alipay",
        "name": "Pro Sub",
        "money": "39.00",
        "trade_status": "TRADE_SUCCESS",
    }
    payload2["sign"] = provider.sign_params(payload2, getattr(provider, "key", ""))
    payload2["sign_type"] = "MD5"

    bill_service.handle_notify(db_session, payload2)

    # 验证第二期订阅处于 PENDING_START，账期接续首期末尾
    sub2 = db_session.scalar(
        select(Subscription).where(
            Subscription.user_id == 20,
            Subscription.id != sub1.id,
        )
    )
    assert sub2 is not None
    assert sub2.status == SubscriptionStatus.PENDING_START
    assert sub2.period_start == sub1.period_end

    # 验证第二期积分批次暂未发放（余额依然只有首期的 500）
    account = db_session.scalar(
        select(CreditAccount).where(CreditAccount.user_id == 20)
    )
    assert account.balance == 500


def test_query_and_close_order(db_session):
    mock_redis = MagicMock()
    with patch("windup_app.server.bill.service.get_redis", return_value=mock_redis):
        order = bill_service.create_order(
            db_session, user_id=30, product_id=None, amount_fen=1000, channel="alipay"
        )

    # 验证查询订单
    found = bill_service.query_order(db_session, order.order_no)
    assert found is not None
    assert found.order_no == order.order_no

    not_found = bill_service.query_order(db_session, "NON_EXISTENT")
    assert not_found is None

    # 验证关单
    closed = bill_service.close_expired_orders(db_session, order.order_no)
    assert closed is True
    assert order.status == OrderStatus.CLOSED
    assert order.closed_at is not None

    # 重复关单返回 False
    assert bill_service.close_expired_orders(db_session, order.order_no) is False
