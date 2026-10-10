from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch
import pytest
from sqlalchemy import select

from windup_app.server.bill.epay import EpayProvider
from windup_app.server.bill.model import (
    Order,
    PaymentEvent,
    Product,
    Subscription,
)
from windup_app.server.bill.provider import ProviderQueryResult, get_provider
from windup_app.server.bill.service import service as bill_service
from windup_app.server.quota.model import CreditAccount, CreditBatch
from windup_app.server.user.model import User
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


def _ensure_user(db_session, user_id: int) -> User:
    """确保测试用户存在（_fulfill_order 需要锁用户行）。"""
    user = db_session.get(User, user_id)
    if user is None:
        user = User(id=user_id, email=f"user{user_id}@example.com", password_hash="")
        db_session.add(user)
        db_session.flush()
    return user


def _patch_query_unpaid(monkeypatch):
    """让 EpayProvider.query_order 返回 unpaid，避免真实 HTTP。"""
    monkeypatch.setattr(
        EpayProvider,
        "query_order",
        lambda self, order_no: ProviderQueryResult(
            order_no=order_no,
            provider_trade_no=None,
            amount_fen=0,
            status="unpaid",
            raw_data={},
        ),
    )


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
    # _fulfill_order 需要锁用户行，先建用户
    _ensure_user(db_session, 10)
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
    # _fulfill_order 需要锁用户行，先建用户
    _ensure_user(db_session, 20)
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


def test_query_and_close_order(db_session, monkeypatch):
    _patch_query_unpaid(monkeypatch)
    # _fulfill_order / query_order 间接需要用户行（如果上游 paid 路径）
    _ensure_user(db_session, 30)
    mock_redis = MagicMock()
    with patch("windup_app.server.bill.service.get_redis", return_value=mock_redis):
        order = bill_service.create_order(
            db_session, user_id=30, product_id=None, amount_fen=1000, channel="alipay"
        )

    # 验证查询订单（PENDING 订单 query_order 会查上游，mock 为 unpaid）
    found = bill_service.query_order(db_session, order.order_no)
    assert found is not None
    assert found.order_no == order.order_no

    not_found = bill_service.query_order(db_session, "NON_EXISTENT")
    assert not_found is None

    # 验证关单
    closed = bill_service.close_expired_orders(db_session, order.order_no)
    assert closed == "closed"
    assert order.status == OrderStatus.CLOSED
    assert order.closed_at is not None

    # 重复关单返回 skipped
    assert bill_service.close_expired_orders(db_session, order.order_no) == "skipped"


def test_handle_notify_rejects_non_success_status(db_session):
    """F1: 非成功 trade_status 的签名合法回调不应发货。"""
    _ensure_user(db_session, 40)
    mock_redis = MagicMock()
    with patch("windup_app.server.bill.service.get_redis", return_value=mock_redis):
        order = bill_service.create_order(
            db_session, user_id=40, product_id=None, amount_fen=1000, channel="alipay"
        )

    provider = get_provider(PaymentProviderType.EPAY)
    # trade_status=TRADE_PENDING：签名合法但支付未完成
    payload = {
        "pid": getattr(provider, "pid", 1000),
        "trade_no": "EPAY_PENDING_01",
        "out_trade_no": order.order_no,
        "type": "alipay",
        "name": "Test Order",
        "money": "10.00",
        "trade_status": "TRADE_PENDING",
    }
    payload["sign"] = provider.sign_params(payload, getattr(provider, "key", ""))
    payload["sign_type"] = "MD5"

    with pytest.raises(BizException):
        bill_service.handle_notify(db_session, payload)

    # 订单仍 PENDING，未发货
    db_session.expire_all()
    o = db_session.scalar(select(Order).where(Order.order_no == order.order_no))
    assert o.status == OrderStatus.PENDING
    account = db_session.scalar(
        select(CreditAccount).where(CreditAccount.user_id == 40)
    )
    assert account is None  # 未建账户


def test_handle_notify_revives_closed_order(db_session):
    """H1a: CLOSED 订单收到合法成功回调时复活为 PAID 并补发货。"""
    _ensure_user(db_session, 50)
    now = datetime.now(timezone.utc)
    order = Order(
        order_no="TEST_REVIVE_01",
        user_id=50,
        product_type=int(ProductType.TOP_UP),
        amount_fen=1000,
        credits=125,
        channel="alipay",
        provider=PaymentProviderType.EPAY,
        status=OrderStatus.CLOSED,
        expire_at=now + timedelta(minutes=15),
        closed_at=now,
    )
    db_session.add(order)
    db_session.flush()

    provider = get_provider(PaymentProviderType.EPAY)
    payload = {
        "pid": getattr(provider, "pid", 1000),
        "trade_no": "EPAY_REVIVE_01",
        "out_trade_no": "TEST_REVIVE_01",
        "type": "alipay",
        "name": "Test Order",
        "money": "10.00",
        "trade_status": "TRADE_SUCCESS",
    }
    payload["sign"] = provider.sign_params(payload, getattr(provider, "key", ""))
    payload["sign_type"] = "MD5"

    bill_service.handle_notify(db_session, payload)

    db_session.expire_all()
    o = db_session.scalar(select(Order).where(Order.order_no == "TEST_REVIVE_01"))
    assert o.status == OrderStatus.PAID
    assert o.paid_at is not None

    account = db_session.scalar(
        select(CreditAccount).where(CreditAccount.user_id == 50)
    )
    assert account is not None
    assert account.balance == 125


def test_close_paid_by_upstream(db_session, monkeypatch):
    """H1b: close 时上游查询发现已支付 → 返回 paid 并发货。"""
    _ensure_user(db_session, 60)
    mock_redis = MagicMock()
    with patch("windup_app.server.bill.service.get_redis", return_value=mock_redis):
        order = bill_service.create_order(
            db_session, user_id=60, product_id=None, amount_fen=1000, channel="alipay"
        )

    # mock 上游查询返回 paid
    monkeypatch.setattr(
        EpayProvider,
        "query_order",
        lambda self, order_no: ProviderQueryResult(
            order_no=order_no,
            provider_trade_no="EPAY_PAID_01",
            amount_fen=1000,
            status="paid",
            raw_data={},
        ),
    )

    result = bill_service.close_expired_orders(db_session, order.order_no)
    assert result == "paid"

    db_session.expire_all()
    o = db_session.scalar(select(Order).where(Order.order_no == order.order_no))
    assert o.status == OrderStatus.PAID
    account = db_session.scalar(
        select(CreditAccount).where(CreditAccount.user_id == 60)
    )
    assert account is not None
    assert account.balance == 125


def test_close_unknown_returns_retry(db_session, monkeypatch):
    """H1b: 上游结果 unknown → 返回 retry，订单保持 PENDING。"""
    _ensure_user(db_session, 70)
    mock_redis = MagicMock()
    with patch("windup_app.server.bill.service.get_redis", return_value=mock_redis):
        order = bill_service.create_order(
            db_session, user_id=70, product_id=None, amount_fen=1000, channel="alipay"
        )

    monkeypatch.setattr(
        EpayProvider,
        "query_order",
        lambda self, order_no: ProviderQueryResult(
            order_no=order_no,
            provider_trade_no=None,
            amount_fen=0,
            status="unknown",
            raw_data={},
        ),
    )

    result = bill_service.close_expired_orders(db_session, order.order_no)
    assert result == "retry"

    db_session.expire_all()
    o = db_session.scalar(select(Order).where(Order.order_no == order.order_no))
    assert o.status == OrderStatus.PENDING


def test_query_order_compensates_paid_upstream(db_session, monkeypatch):
    """F7: query_order 对 PENDING 订单向上游补偿查询，paid 则补发货。"""
    _ensure_user(db_session, 80)
    mock_redis = MagicMock()
    with patch("windup_app.server.bill.service.get_redis", return_value=mock_redis):
        order = bill_service.create_order(
            db_session, user_id=80, product_id=None, amount_fen=1000, channel="alipay"
        )

    monkeypatch.setattr(
        EpayProvider,
        "query_order",
        lambda self, order_no: ProviderQueryResult(
            order_no=order_no,
            provider_trade_no="EPAY_COMP_01",
            amount_fen=1000,
            status="paid",
            raw_data={},
        ),
    )

    result = bill_service.query_order(db_session, order.order_no)
    assert result is not None
    assert result.status == OrderStatus.PAID

    account = db_session.scalar(
        select(CreditAccount).where(CreditAccount.user_id == 80)
    )
    assert account is not None
    assert account.balance == 125


def test_query_order_compensates_amount_mismatch(db_session, monkeypatch):
    """F7: 上游 paid 但金额不符，不发货。"""
    _ensure_user(db_session, 90)
    mock_redis = MagicMock()
    with patch("windup_app.server.bill.service.get_redis", return_value=mock_redis):
        order = bill_service.create_order(
            db_session, user_id=90, product_id=None, amount_fen=1000, channel="alipay"
        )

    monkeypatch.setattr(
        EpayProvider,
        "query_order",
        lambda self, order_no: ProviderQueryResult(
            order_no=order_no,
            provider_trade_no="EPAY_BAD",
            amount_fen=500,  # 金额不符
            status="paid",
            raw_data={},
        ),
    )

    result = bill_service.query_order(db_session, order.order_no)
    assert result is not None
    assert result.status == OrderStatus.PENDING  # 不发货
