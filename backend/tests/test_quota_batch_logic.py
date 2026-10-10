from datetime import datetime, timedelta, timezone
from sqlalchemy import select

from windup_app.server.quota.model import (
    CreditAccount,
    CreditBatch,
    CreditFreezeAlloc,
    CreditRedemptionCode,
)
from windup_app.server.quota.service import (
    redemption_code_hash,
    service as quota_service,
)
from windup_common.enums.quota import CreditReason


def test_credit_batch_allocation(db_session):
    # Setup test user and raw account
    account = CreditAccount(
        user_id=999,
        balance=0,
        frozen=0,
        total_earned=0,
        total_spent=0,
    )
    db_session.add(account)
    db_session.flush()

    quota_service.credit(db_session, 999, 100, int(CreditReason.REGISTER_GIFT), "ref:gift")

    # 1. Test Reserve
    quota_service.reserve_credit(db_session, 999, 50, "task:1")
    acc = quota_service.get_account(db_session, 999)
    assert acc.balance == 50
    assert acc.frozen == 50

    # 2. Test Capture
    quota_service.capture_credit(db_session, 999, 30, "task:1", 50)  # Refund 20
    acc = quota_service.get_account(db_session, 999)
    assert acc.balance == 70
    assert acc.frozen == 0

    # 3. Test Release
    quota_service.reserve_credit(db_session, 999, 20, "task:2")
    quota_service.release_credit(db_session, 999, 20, "task:2")
    acc = quota_service.get_account(db_session, 999)
    assert acc.balance == 70
    assert acc.frozen == 0


def test_credit_batch_allocation_records(db_session):
    account = CreditAccount(
        user_id=999,
        balance=0,
        frozen=0,
        total_earned=0,
        total_spent=0,
    )
    db_session.add(account)
    db_session.flush()

    quota_service.credit(db_session, 999, 100, int(CreditReason.REGISTER_GIFT), "ref:gift")
    batches = db_session.scalars(
        select(CreditBatch).where(CreditBatch.user_id == 999)
    ).all()
    assert len(batches) == 1
    assert batches[0].total == 100
    assert batches[0].remaining == 100
    assert batches[0].frozen == 0
    assert batches[0].is_exhausted == 0


def test_credit_batch_priority_subscription_over_topup(db_session):
    """验证消耗优先级：SUBSCRIPTION 批次优先于 TOP_UP 批次。"""
    account = CreditAccount(
        user_id=1001,
        balance=0,
        frozen=0,
        total_earned=0,
        total_spent=0,
    )
    db_session.add(account)
    db_session.flush()

    # 先充值入账 100
    quota_service.credit(db_session, 1001, 100, int(CreditReason.TOP_UP), "order:topup_1")
    # 后订阅入账 100，带过期时间
    sub_expire = datetime.now(timezone.utc) + timedelta(days=30)
    quota_service.credit(
        db_session,
        1001,
        100,
        int(CreditReason.SUBSCRIPTION),
        "order:sub_1",
        expires_at=sub_expire,
    )

    acc = quota_service.get_account(db_session, 1001)
    assert acc.balance == 200

    # 冻结 60，应当全部从 SUBSCRIPTION 扣除
    quota_service.reserve_credit(db_session, 1001, 60, "task:sub_prio")

    sub_batch = db_session.scalar(
        select(CreditBatch).where(
            CreditBatch.user_id == 1001,
            CreditBatch.source_type == int(CreditReason.SUBSCRIPTION),
        )
    )
    topup_batch = db_session.scalar(
        select(CreditBatch).where(
            CreditBatch.user_id == 1001,
            CreditBatch.source_type == int(CreditReason.TOP_UP),
        )
    )

    assert sub_batch.remaining == 40
    assert sub_batch.frozen == 60
    assert topup_batch.remaining == 100
    assert topup_batch.frozen == 0

    allocs = db_session.scalars(
        select(CreditFreezeAlloc).where(CreditFreezeAlloc.freeze_ref == "task:sub_prio")
    ).all()
    assert len(allocs) == 1
    assert allocs[0].batch_id == sub_batch.id
    assert allocs[0].amount == 60
    assert allocs[0].status == 1  # FROZEN


def test_credit_batch_expiry_ordering(db_session):
    """验证快过期的批次优先消耗。"""
    account = CreditAccount(
        user_id=1002,
        balance=0,
        frozen=0,
        total_earned=0,
        total_spent=0,
    )
    db_session.add(account)
    db_session.flush()

    now = datetime.now(timezone.utc)
    # 批次 1: 5 天后过期
    quota_service.credit(
        db_session,
        1002,
        50,
        int(CreditReason.SUBSCRIPTION),
        "sub:early",
        expires_at=now + timedelta(days=5),
    )
    # 批次 2: 20 天后过期
    quota_service.credit(
        db_session,
        1002,
        50,
        int(CreditReason.SUBSCRIPTION),
        "sub:late",
        expires_at=now + timedelta(days=20),
    )

    # 冻结 30，优先扣 5 天后过期的批次
    quota_service.reserve_credit(db_session, 1002, 30, "task:exp")

    early_batch = db_session.scalar(
        select(CreditBatch).where(
            CreditBatch.user_id == 1002,
            CreditBatch.source_ref == "sub:early",
        )
    )
    late_batch = db_session.scalar(
        select(CreditBatch).where(
            CreditBatch.user_id == 1002,
            CreditBatch.source_ref == "sub:late",
        )
    )

    assert early_batch.remaining == 20
    assert early_batch.frozen == 30
    assert late_batch.remaining == 50
    assert late_batch.frozen == 0


def test_credit_batch_multi_alloc_capture_and_refund(db_session):
    """跨多批次冻结，扣减部分并差额退回。"""
    account = CreditAccount(
        user_id=1003,
        balance=0,
        frozen=0,
        total_earned=0,
        total_spent=0,
    )
    db_session.add(account)
    db_session.flush()

    now = datetime.now(timezone.utc)
    # 批次 1: 30 积分
    quota_service.credit(
        db_session,
        1003,
        30,
        int(CreditReason.SUBSCRIPTION),
        "sub:b1",
        expires_at=now + timedelta(days=5),
    )
    # 批次 2: 20 积分
    quota_service.credit(
        db_session,
        1003,
        20,
        int(CreditReason.SUBSCRIPTION),
        "sub:b2",
        expires_at=now + timedelta(days=10),
    )

    # 冻结 50（刚好耗尽两批次）
    quota_service.reserve_credit(db_session, 1003, 50, "task:multi")

    b1 = db_session.scalar(select(CreditBatch).where(CreditBatch.source_ref == "sub:b1"))
    b2 = db_session.scalar(select(CreditBatch).where(CreditBatch.source_ref == "sub:b2"))
    assert b1.remaining == 0 and b1.frozen == 30 and b1.is_exhausted == 0
    assert b2.remaining == 0 and b2.frozen == 20 and b2.is_exhausted == 0

    allocs = db_session.scalars(
        select(CreditFreezeAlloc)
        .where(CreditFreezeAlloc.freeze_ref == "task:multi")
        .order_by(CreditFreezeAlloc.id.asc())
    ).all()
    assert len(allocs) == 2
    assert allocs[0].amount == 30 and allocs[0].status == 1
    assert allocs[1].amount == 20 and allocs[1].status == 1

    # 实际扣减 35，退回 15
    quota_service.capture_credit(db_session, 1003, 35, "task:multi", 50)

    db_session.expire_all()
    b1_after = db_session.scalar(select(CreditBatch).where(CreditBatch.source_ref == "sub:b1"))
    b2_after = db_session.scalar(select(CreditBatch).where(CreditBatch.source_ref == "sub:b2"))

    # b1 贡献 30: 全部扣除，frozen=0, remaining=0 -> is_exhausted=1
    assert b1_after.frozen == 0
    assert b1_after.remaining == 0
    assert b1_after.is_exhausted == 1

    # b2 贡献 20: 扣除 5，退回 15 -> remaining=15, frozen=0 -> is_exhausted=0
    assert b2_after.frozen == 0
    assert b2_after.remaining == 15
    assert b2_after.is_exhausted == 0

    # 两个 alloc 的 status 变为 2 (CAPTURED)
    allocs_after = db_session.scalars(
        select(CreditFreezeAlloc).where(CreditFreezeAlloc.freeze_ref == "task:multi")
    ).all()
    assert all(a.status == 2 for a in allocs_after)

    # 账户余额检查: 50 - 35 = 15 可用, 0 冻结, total_spent = 35
    acc = quota_service.get_account(db_session, 1003)
    assert acc.balance == 15
    assert acc.frozen == 0
    assert acc.total_spent == 35


def test_credit_batch_multi_alloc_release(db_session):
    """跨多批次冻结后完全解冻。"""
    account = CreditAccount(
        user_id=1004,
        balance=0,
        frozen=0,
        total_earned=0,
        total_spent=0,
    )
    db_session.add(account)
    db_session.flush()

    quota_service.credit(db_session, 1004, 30, int(CreditReason.TOP_UP), "top:1")
    quota_service.credit(db_session, 1004, 20, int(CreditReason.TOP_UP), "top:2")

    quota_service.reserve_credit(db_session, 1004, 50, "task:rel")
    quota_service.release_credit(db_session, 1004, 50, "task:rel")

    db_session.expire_all()
    b1 = db_session.scalar(select(CreditBatch).where(CreditBatch.source_ref == "top:1"))
    b2 = db_session.scalar(select(CreditBatch).where(CreditBatch.source_ref == "top:2"))
    assert b1.remaining == 30 and b1.frozen == 0 and b1.is_exhausted == 0
    assert b2.remaining == 20 and b2.frozen == 0 and b2.is_exhausted == 0

    allocs = db_session.scalars(
        select(CreditFreezeAlloc).where(CreditFreezeAlloc.freeze_ref == "task:rel")
    ).all()
    assert all(a.status == 3 for a in allocs)

    acc = quota_service.get_account(db_session, 1004)
    assert acc.balance == 50
    assert acc.frozen == 0


def test_redeem_code_creates_batch(db_session):
    """验证兑换码成功兑换时生成 CreditBatch。"""
    account = CreditAccount(
        user_id=1005,
        balance=0,
        frozen=0,
        total_earned=0,
        total_spent=0,
    )
    db_session.add(account)
    db_session.flush()

    raw_code = "WUEXAMPLETEST1"
    row = CreditRedemptionCode(
        code_hash=redemption_code_hash(raw_code),
        amount=500,
        expires_at=None,
    )
    db_session.add(row)
    db_session.flush()

    amt, acc_view = quota_service.redeem_code(db_session, 1005, raw_code)
    assert amt == 500
    assert acc_view.balance == 500

    batches = db_session.scalars(
        select(CreditBatch).where(CreditBatch.user_id == 1005)
    ).all()
    assert len(batches) == 1
    assert batches[0].total == 500
    assert batches[0].remaining == 500
    assert batches[0].source_type == int(CreditReason.REDEMPTION)
    assert batches[0].source_ref == f"redemption:{row.id}"


def test_reserve_lazy_expires_stale_batches(db_session):
    """F5: reserve 时惰性清零已过期未清理的订阅批次，过期积分不可用。"""
    now = datetime.now(timezone.utc)
    account = CreditAccount(
        user_id=2001,
        balance=200,
        frozen=0,
        total_earned=200,
        total_spent=0,
    )
    db_session.add(account)
    # 一个已过期未清理的订阅批次 + 一个未过期的永久批次
    expired_batch = CreditBatch(
        user_id=2001,
        source_type=int(CreditReason.SUBSCRIPTION),
        source_ref="sub:lazy",
        total=100,
        remaining=100,
        frozen=0,
        is_exhausted=0,
        expires_at=now - timedelta(minutes=5),
    )
    active_batch = CreditBatch(
        user_id=2001,
        source_type=int(CreditReason.REGISTER_GIFT),
        source_ref="register:2001",
        total=100,
        remaining=100,
        frozen=0,
        is_exhausted=0,
        expires_at=None,
    )
    db_session.add(expired_batch)
    db_session.add(active_batch)
    db_session.flush()

    # reserve 50：惰性过期先清零 100（balance 200→100），再从活跃批次冻结 50
    quota_service.reserve_credit(db_session, 2001, 50, "task:lazy")

    db_session.refresh(expired_batch)
    assert expired_batch.remaining == 0
    assert expired_batch.is_exhausted == 1

    db_session.refresh(account)
    assert account.balance == 50  # 200 - 100(惰性过期) - 50(冻结)
    assert account.frozen == 50

    # 过期流水已写
    from windup_app.server.quota.model import CreditTransaction
    txn = db_session.scalar(
        select(CreditTransaction).where(
            CreditTransaction.ref_id == f"lazy:batch:{expired_batch.id}"
        )
    )
    assert txn is not None
    assert txn.reason == int(CreditReason.SUBSCRIPTION_EXPIRE)


def test_release_expired_batch_does_not_revive(db_session):
    """H2: 冻结跨越过期点的积分，解冻时过期部分不回余额。"""
    now = datetime.now(timezone.utc)
    account = CreditAccount(
        user_id=2002,
        balance=200,
        frozen=0,
        total_earned=200,
        total_spent=0,
    )
    db_session.add(account)
    # 两个批次：一个已过期，一个未过期
    expired_batch = CreditBatch(
        user_id=2002,
        source_type=int(CreditReason.SUBSCRIPTION),
        source_ref="sub:expired",
        total=100,
        remaining=100,
        frozen=0,
        is_exhausted=0,
        expires_at=now - timedelta(minutes=1),
    )
    active_batch = CreditBatch(
        user_id=2002,
        source_type=int(CreditReason.REGISTER_GIFT),
        source_ref="register:1",
        total=100,
        remaining=100,
        frozen=0,
        is_exhausted=0,
        expires_at=None,
    )
    db_session.add(expired_batch)
    db_session.add(active_batch)
    db_session.flush()

    # 冻结 150（先从过期批次扣 100，再从活跃批次扣 50）
    # 但 reserve 的惰性过期会先清零过期批次 → 过期批 remaining=0，不参与冻结
    # 所以只从活跃批次冻结 150 → 余额不足（活跃只有 100）
    # 改为冻结 100（全部从活跃批次）
    quota_service.reserve_credit(db_session, 2002, 100, "task:cross_expire")
    db_session.refresh(account)
    assert account.balance == 0
    assert account.frozen == 100

    # 标记批次为已过期（模拟冻结后、解冻前过期了）
    db_session.refresh(active_batch)
    active_batch.expires_at = now - timedelta(minutes=1)
    db_session.flush()

    # 解冻 100：批次已过期，不应回余额
    quota_service.release_credit(db_session, 2002, 100, "task:cross_expire")
    db_session.refresh(account)
    assert account.balance == 0  # 过期部分不回余额
    assert account.frozen == 0


def test_capture_expired_batch_refund_does_not_revive(db_session):
    """H2: capture 差额返还时，过期批次部分不回余额。"""
    now = datetime.now(timezone.utc)
    account = CreditAccount(
        user_id=2003,
        balance=200,
        frozen=0,
        total_earned=200,
        total_spent=0,
    )
    db_session.add(account)
    batch = CreditBatch(
        user_id=2003,
        source_type=int(CreditReason.REGISTER_GIFT),
        source_ref="register:2",
        total=200,
        remaining=200,
        frozen=0,
        is_exhausted=0,
        expires_at=None,
    )
    db_session.add(batch)
    db_session.flush()

    # 冻结 200
    quota_service.reserve_credit(db_session, 2003, 200, "task:capture_expire")
    db_session.refresh(account)
    assert account.balance == 0
    assert account.frozen == 200

    # 标记批次过期
    db_session.refresh(batch)
    batch.expires_at = now - timedelta(minutes=1)
    db_session.flush()

    # 实际消耗 50，差额 150 应返还但不回余额（批次已过期）
    quota_service.capture_credit(db_session, 2003, 50, "task:capture_expire", 200)
    db_session.refresh(account)
    assert account.balance == 0  # 过期部分不回余额
    assert account.frozen == 0
    assert account.total_spent == 50
