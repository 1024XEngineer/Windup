from datetime import datetime, timedelta, timezone

from sqlalchemy import select

from windup_app.server.bill.model import Order, Subscription
from windup_app.server.bill.service import service as bill_service
from windup_app.server.quota.model import CreditAccount, CreditBatch, CreditTransaction
from windup_common.enums.bill import OrderStatus, PaymentProviderType, SubscriptionStatus, SubscriptionTier
from windup_common.enums.quota import CreditReason


def test_close_expired_orders(db_session):
    """Test closing an expired PENDING order."""
    now = datetime.now(timezone.utc)
    order = Order(
        order_no="TEST_CLOSE_01",
        user_id=1,
        product_id=None,
        product_type=1,
        amount_fen=1000,
        credits=100,
        channel="alipay",
        provider=PaymentProviderType.EPAY,
        status=OrderStatus.PENDING,
        expire_at=now - timedelta(minutes=1),
    )
    db_session.add(order)
    db_session.flush()

    # Close the order
    result = bill_service.close_expired_orders(db_session, "TEST_CLOSE_01")
    assert result is True

    # Verify status and closed_at
    closed_order = db_session.scalar(select(Order).where(Order.order_no == "TEST_CLOSE_01"))
    assert closed_order.status == OrderStatus.CLOSED
    assert closed_order.closed_at is not None

def test_close_expired_orders_non_pending(db_session):
    """Test closing ignores non-PENDING orders."""
    now = datetime.now(timezone.utc)
    order = Order(
        order_no="TEST_CLOSE_02",
        user_id=1,
        product_id=None,
        product_type=1,
        amount_fen=1000,
        credits=100,
        channel="alipay",
        provider=PaymentProviderType.EPAY,
        status=OrderStatus.PAID,
        expire_at=now - timedelta(minutes=1),
        paid_at=now - timedelta(seconds=10),
    )
    db_session.add(order)
    db_session.flush()

    # Attempt to close
    result = bill_service.close_expired_orders(db_session, "TEST_CLOSE_02")
    assert result is False

    # Verify untouched
    unchanged_order = db_session.scalar(select(Order).where(Order.order_no == "TEST_CLOSE_02"))
    assert unchanged_order.status == OrderStatus.PAID
    assert unchanged_order.closed_at is None


def test_process_expired_subscriptions(db_session):
    """Test processing an expired active subscription."""
    now = datetime.now(timezone.utc)
    # Set up user account and batch
    account = CreditAccount(user_id=10, balance=400, frozen=0, total_earned=400, total_spent=0)
    db_session.add(account)
    db_session.flush()

    # Insert expired active subscription
    sub = Subscription(
        user_id=10,
        order_id=1,
        tier=SubscriptionTier.PLUS,
        period_start=now - timedelta(days=60),
        period_end=now - timedelta(days=30),
        credits_granted=400,
        status=SubscriptionStatus.ACTIVE,
    )
    db_session.add(sub)
    db_session.flush()

    batch = CreditBatch(
        user_id=10,
        source_type=int(CreditReason.SUBSCRIPTION),
        source_ref=f"sub:{sub.id}",
        total=400,
        remaining=400,
        frozen=0,
        is_exhausted=0,
        expires_at=now - timedelta(days=30),
    )
    db_session.add(batch)
    db_session.flush()

    # Process expirations
    count = bill_service.process_expired_subscriptions(db_session)
    assert count == 1

    # Verify subscription status
    assert sub.status == SubscriptionStatus.EXPIRED

    # Verify batch
    db_session.refresh(batch)
    assert batch.remaining == 0
    assert batch.is_exhausted == 1

    # Verify account balance
    db_session.refresh(account)
    assert account.balance == 0

    # Verify transaction
    txn = db_session.scalar(select(CreditTransaction).where(CreditTransaction.ref_id == f"expire:sub:{sub.id}"))
    assert txn is not None
    assert txn.reason == int(CreditReason.SUBSCRIPTION_EXPIRE)
    assert txn.delta == -400
    assert txn.balance_after == 0


def test_process_expired_subscriptions_rollover(db_session):
    """Test rolling over to a queued subscription."""
    now = datetime.now(timezone.utc)

    account = CreditAccount(user_id=11, balance=100, frozen=0, total_earned=100, total_spent=0)
    db_session.add(account)
    db_session.flush()

    # Expired sub
    sub1 = Subscription(
        user_id=11,
        order_id=2,
        tier=SubscriptionTier.PLUS,
        period_start=now - timedelta(days=30),
        period_end=now - timedelta(minutes=1),
        credits_granted=400,
        status=SubscriptionStatus.ACTIVE,
    )
    db_session.add(sub1)
    db_session.flush()

    batch1 = CreditBatch(
        user_id=11,
        source_type=int(CreditReason.SUBSCRIPTION),
        source_ref=f"sub:{sub1.id}",
        total=400,
        remaining=100,
        frozen=0,
        is_exhausted=0,
        expires_at=now - timedelta(minutes=1),
    )
    db_session.add(batch1)
    db_session.flush()

    # Queued sub
    sub2 = Subscription(
        user_id=11,
        order_id=3,
        tier=SubscriptionTier.PLUS,
        period_start=now - timedelta(minutes=1),
        period_end=now + timedelta(days=30) - timedelta(minutes=1),
        credits_granted=400,
        status=SubscriptionStatus.PENDING_START,
    )
    db_session.add(sub2)
    db_session.flush()

    # Process expirations
    count = bill_service.process_expired_subscriptions(db_session)
    assert count == 1

    # Verify sub1 expired and balance deducted
    assert sub1.status == SubscriptionStatus.EXPIRED
    db_session.refresh(batch1)
    assert batch1.remaining == 0
    assert batch1.is_exhausted == 1

    # Verify sub2 became active and granted credits
    db_session.refresh(sub2)
    assert sub2.status == SubscriptionStatus.ACTIVE

    batch2 = db_session.scalar(select(CreditBatch).where(CreditBatch.source_ref == f"sub:{sub2.id}"))
    assert batch2 is not None
    assert batch2.total == 400
    assert batch2.remaining == 400
    assert batch2.expires_at == sub2.period_end

    db_session.refresh(account)
    # started with 100, deducted 100 from expired batch, added 400 from new sub
    assert account.balance == 400

def test_process_expired_subscriptions_future(db_session):
    """Test that active subscriptions ending in the future are untouched."""
    now = datetime.now(timezone.utc)
    sub = Subscription(
        user_id=12,
        order_id=4,
        tier=SubscriptionTier.PLUS,
        period_start=now - timedelta(days=10),
        period_end=now + timedelta(days=20),
        credits_granted=400,
        status=SubscriptionStatus.ACTIVE,
    )
    db_session.add(sub)
    db_session.flush()

    count = bill_service.process_expired_subscriptions(db_session)
    assert count == 0
    assert sub.status == SubscriptionStatus.ACTIVE

def test_process_expired_subscriptions_batch_frozen(db_session):
    """Test that if a batch has frozen credits, is_exhausted is set to 0."""
    now = datetime.now(timezone.utc)
    account = CreditAccount(user_id=13, balance=200, frozen=50, total_earned=250, total_spent=0)
    db_session.add(account)
    db_session.flush()

    sub = Subscription(
        user_id=13,
        order_id=5,
        tier=SubscriptionTier.PLUS,
        period_start=now - timedelta(days=30),
        period_end=now - timedelta(minutes=1),
        credits_granted=400,
        status=SubscriptionStatus.ACTIVE,
    )
    db_session.add(sub)
    db_session.flush()

    batch = CreditBatch(
        user_id=13,
        source_type=int(CreditReason.SUBSCRIPTION),
        source_ref=f"sub:{sub.id}",
        total=400,
        remaining=200,
        frozen=50,  # 50 frozen
        is_exhausted=0,
        expires_at=now - timedelta(minutes=1),
    )
    db_session.add(batch)
    db_session.flush()

    count = bill_service.process_expired_subscriptions(db_session)
    assert count == 1

    db_session.refresh(batch)
    assert batch.remaining == 0
    assert batch.frozen == 50
    assert batch.is_exhausted == 0  # Not fully exhausted because of frozen

    db_session.refresh(account)
    assert account.balance == 0 # 200 deducted
