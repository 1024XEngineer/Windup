"""积分模块测试。

覆盖场景：
1. Service 层：余额查询、预付费冻结/扣减/解冻、入账、流水查询、边界异常
2. API 层：余额端点、流水端点、无账户时 404、分页参数
"""

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from windup_common.enums.quota import CreditReason
from windup_framework.config.quota import settings as quota_settings
from windup_common.exceptions import BizException

from windup_app.server.quota.model import CreditAccount, CreditTransaction
from windup_app.server.quota.service import SqlAlchemyQuotaService


@pytest.fixture()
def quota_service():
    return SqlAlchemyQuotaService()


@pytest.fixture()
def user_with_account(db_session: Session):
    """创建一个带积分账户的测试用户（user_id=1，与 auth_client token 对应）。"""
    from windup_app.server.user.model import User

    user = User(id=1, email="quota_test@example.com", password_hash="")
    db_session.add(user)
    db_session.flush()

    account = CreditAccount(
        user_id=user.id,
        balance=quota_settings.register_gift_amount,
        frozen=0,
        total_earned=quota_settings.register_gift_amount,
        total_spent=0,
    )
    db_session.add(account)
    db_session.flush()

    return user


@pytest.fixture()
def auth_quota_client(engine, user_with_account):
    """带认证且预置积分账户的 TestClient。"""
    from fastapi.testclient import TestClient
    from sqlalchemy.orm import sessionmaker

    from windup_app.bootstrap.app import create_app
    from windup_app.server.user.service import create_access_token
    from windup_framework.db import get_session

    session_local = sessionmaker(bind=engine, expire_on_commit=False)

    def override_get_session():
        session = session_local()
        try:
            yield session
            session.commit()
        except Exception:
            session.rollback()
            raise
        finally:
            session.close()

    app = create_app()
    app.dependency_overrides[get_session] = override_get_session

    token = create_access_token(1, "quota_test@example.com")
    client = TestClient(app, headers={"Authorization": f"Bearer {token}"})

    yield client
    app.dependency_overrides.clear()


# ══════════════════════════════════════════════════════════════════════════════
# Service 层测试
# ══════════════════════════════════════════════════════════════════════════════


# -- 余额查询 ---------------------------------------------------------------


class TestGetAccount:
    def test_get_existing_account(self, db_session, quota_service, user_with_account):
        view = quota_service.get_account(db_session, user_with_account.id)
        assert view is not None
        assert view.balance == quota_settings.register_gift_amount
        assert view.frozen == 0
        assert view.total_earned == quota_settings.register_gift_amount
        assert view.total_spent == 0
        assert view.user_id == user_with_account.id

    def test_get_nonexistent_account(self, db_session, quota_service):
        view = quota_service.get_account(db_session, 99999)
        assert view is None


# -- 预付费：冻结 -----------------------------------------------------------


class TestReserveCredit:
    def test_reserve_success(self, db_session, quota_service, user_with_account):
        uid = user_with_account.id
        quota_service.reserve_credit(
            db_session, uid, quota_settings.generate_image_cost, "task:1"
        )

        account = db_session.scalar(
            select(CreditAccount).where(CreditAccount.user_id == uid)
        )
        assert (
            account.balance
            == quota_settings.register_gift_amount - quota_settings.generate_image_cost
        )
        assert account.frozen == quota_settings.generate_image_cost

    def test_reserve_insufficient(self, db_session, quota_service, user_with_account):
        uid = user_with_account.id
        with pytest.raises(BizException, match="积分不足"):
            quota_service.reserve_credit(
                db_session, uid, quota_settings.register_gift_amount + 1, "task:2"
            )

    def test_reserve_nonexistent_account(self, db_session, quota_service):
        with pytest.raises(BizException, match="积分账户不存在"):
            quota_service.reserve_credit(db_session, 99999, 10, "task:x")

    def test_reserve_writes_txn(self, db_session, quota_service, user_with_account):
        uid = user_with_account.id
        quota_service.reserve_credit(
            db_session, uid, quota_settings.generate_image_cost, "task:3"
        )

        txn = db_session.scalar(
            select(CreditTransaction).where(
                CreditTransaction.user_id == uid, CreditTransaction.ref_id == "task:3"
            )
        )
        assert txn is not None
        assert txn.delta == -quota_settings.generate_image_cost
        assert txn.reason == CreditReason.FROZEN
        assert txn.billing_mode == 0  # PREPAID


# -- 预付费：扣减 -----------------------------------------------------------


class TestCaptureCredit:
    def test_capture_full(self, db_session, quota_service, user_with_account):
        uid = user_with_account.id
        cost = quota_settings.generate_image_cost
        quota_service.reserve_credit(db_session, uid, cost, "task:3")
        quota_service.capture_credit(db_session, uid, cost, "task:3", cost)

        account = db_session.scalar(
            select(CreditAccount).where(CreditAccount.user_id == uid)
        )
        assert account.balance == quota_settings.register_gift_amount - cost
        assert account.frozen == 0
        assert account.total_spent == cost

    def test_capture_partial_refund(self, db_session, quota_service, user_with_account):
        """冻结 50，实际扣 30，差额 20 退回。"""
        uid = user_with_account.id
        quota_service.reserve_credit(
            db_session, uid, quota_settings.generate_action_cost, "task:4"
        )
        quota_service.capture_credit(
            db_session, uid, 30, "task:4", quota_settings.generate_action_cost
        )

        account = db_session.scalar(
            select(CreditAccount).where(CreditAccount.user_id == uid)
        )
        assert account.balance == quota_settings.register_gift_amount - 30
        assert account.frozen == 0
        assert account.total_spent == 30

    def test_capture_writes_txn_and_refund(
        self, db_session, quota_service, user_with_account
    ):
        """有差额退回时应写两条流水：扣减 + 退款。"""
        uid = user_with_account.id
        quota_service.reserve_credit(
            db_session, uid, quota_settings.generate_action_cost, "task:5"
        )
        quota_service.capture_credit(
            db_session, uid, 30, "task:5", quota_settings.generate_action_cost
        )

        txns = db_session.scalars(
            select(CreditTransaction).where(CreditTransaction.user_id == uid)
        ).all()
        reasons = [t.reason for t in txns]
        assert CreditReason.CAPTURED in reasons
        assert CreditReason.REFUND in reasons

    def test_capture_insufficient_frozen(
        self, db_session, quota_service, user_with_account
    ):
        """冻结额度不足时应抛异常。"""
        uid = user_with_account.id
        quota_service.reserve_credit(
            db_session, uid, quota_settings.generate_image_cost, "task:6"
        )
        with pytest.raises(BizException, match="冻结额度不足"):
            quota_service.capture_credit(db_session, uid, 100, "task:6", 100)

    def test_capture_nonexistent_account(self, db_session, quota_service):
        with pytest.raises(BizException, match="积分账户不存在"):
            quota_service.capture_credit(db_session, 99999, 10, "task:x", 10)


# -- 预付费：解冻 -----------------------------------------------------------


class TestReleaseCredit:
    def test_release_success(self, db_session, quota_service, user_with_account):
        uid = user_with_account.id
        quota_service.reserve_credit(
            db_session, uid, quota_settings.generate_image_cost, "task:7"
        )
        quota_service.release_credit(
            db_session, uid, quota_settings.generate_image_cost, "task:7"
        )

        account = db_session.scalar(
            select(CreditAccount).where(CreditAccount.user_id == uid)
        )
        assert account.balance == quota_settings.register_gift_amount
        assert account.frozen == 0

    def test_release_writes_txn(self, db_session, quota_service, user_with_account):
        uid = user_with_account.id
        quota_service.reserve_credit(
            db_session, uid, quota_settings.generate_image_cost, "task:8"
        )
        quota_service.release_credit(
            db_session, uid, quota_settings.generate_image_cost, "task:8"
        )

        txn = db_session.scalar(
            select(CreditTransaction).where(
                CreditTransaction.user_id == uid,
                CreditTransaction.reason == CreditReason.REFUND,
            )
        )
        assert txn is not None
        assert txn.delta == quota_settings.generate_image_cost

    def test_release_insufficient_frozen(
        self, db_session, quota_service, user_with_account
    ):
        uid = user_with_account.id
        with pytest.raises(BizException, match="冻结额度不足"):
            quota_service.release_credit(db_session, uid, 100, "task:9")

    def test_release_nonexistent_account(self, db_session, quota_service):
        with pytest.raises(BizException, match="积分账户不存在"):
            quota_service.release_credit(db_session, 99999, 10, "task:x")


# -- 入账 -------------------------------------------------------------------


class TestCredit:
    def test_credit_success(self, db_session, quota_service, user_with_account):
        uid = user_with_account.id
        quota_service.credit(db_session, uid, 50, CreditReason.ADMIN_ADJUST, "admin:1")

        account = db_session.scalar(
            select(CreditAccount).where(CreditAccount.user_id == uid)
        )
        assert account.balance == quota_settings.register_gift_amount + 50
        assert account.total_earned == quota_settings.register_gift_amount + 50

    def test_credit_writes_txn(self, db_session, quota_service, user_with_account):
        uid = user_with_account.id
        quota_service.credit(db_session, uid, 50, CreditReason.ADMIN_ADJUST, "admin:2")

        txn = db_session.scalar(
            select(CreditTransaction).where(
                CreditTransaction.user_id == uid, CreditTransaction.ref_id == "admin:2"
            )
        )
        assert txn is not None
        assert txn.delta == 50
        assert txn.reason == CreditReason.ADMIN_ADJUST

    def test_credit_zero_noop(self, db_session, quota_service, user_with_account):
        """amount <= 0 时不做任何操作。"""
        uid = user_with_account.id
        quota_service.credit(db_session, uid, 0, CreditReason.ADMIN_ADJUST, "admin:3")

        account = db_session.scalar(
            select(CreditAccount).where(CreditAccount.user_id == uid)
        )
        assert account.balance == quota_settings.register_gift_amount

    def test_credit_negative_noop(self, db_session, quota_service, user_with_account):
        uid = user_with_account.id
        quota_service.credit(db_session, uid, -10, CreditReason.ADMIN_ADJUST, "admin:4")

        account = db_session.scalar(
            select(CreditAccount).where(CreditAccount.user_id == uid)
        )
        assert account.balance == quota_settings.register_gift_amount

    def test_credit_nonexistent_account(self, db_session, quota_service):
        with pytest.raises(BizException, match="积分账户不存在"):
            quota_service.credit(db_session, 99999, 50, CreditReason.ADMIN_ADJUST)


# -- 流水查询 ---------------------------------------------------------------


class TestListTransactions:
    def test_list_empty(self, db_session, quota_service, user_with_account):
        txns, total = quota_service.list_transactions(db_session, user_with_account.id)
        assert total == 0
        assert txns == []

    def test_list_after_operations(self, db_session, quota_service, user_with_account):
        uid = user_with_account.id
        quota_service.reserve_credit(
            db_session, uid, quota_settings.generate_image_cost, "task:10"
        )
        quota_service.capture_credit(
            db_session,
            uid,
            quota_settings.generate_image_cost,
            "task:10",
            quota_settings.generate_image_cost,
        )

        txns, total = quota_service.list_transactions(db_session, uid)
        assert total >= 2
        assert txns[0].ref_id == "task:10"  # 最新的在前

    def test_list_pagination(self, db_session, quota_service, user_with_account):
        uid = user_with_account.id
        for i in range(5):
            quota_service.credit(
                db_session, uid, 10, CreditReason.ADMIN_ADJUST, f"page:{i}"
            )

        txns_p1, total = quota_service.list_transactions(
            db_session, uid, page=1, page_size=2
        )
        assert total == 5
        assert len(txns_p1) == 2

        txns_p3, _ = quota_service.list_transactions(
            db_session, uid, page=3, page_size=2
        )
        assert len(txns_p3) == 1  # 最后一页只有 1 条

    def test_list_other_user_empty(self, db_session, quota_service, user_with_account):
        """查另一个用户的流水应为空。"""
        txns, total = quota_service.list_transactions(db_session, 99999)
        assert total == 0
        assert txns == []


# -- 预付费完整流程 ----------------------------------------------------------


class TestPrepaidFlow:
    def test_full_flow_success(self, db_session, quota_service, user_with_account):
        """冻结 → 扣减，余额和冻结都正确。"""
        uid = user_with_account.id
        cost = quota_settings.generate_image_cost

        quota_service.reserve_credit(db_session, uid, cost, "flow:1")
        quota_service.capture_credit(db_session, uid, cost, "flow:1", cost)

        account = db_session.scalar(
            select(CreditAccount).where(CreditAccount.user_id == uid)
        )
        assert account.balance == quota_settings.register_gift_amount - cost
        assert account.frozen == 0
        assert account.total_spent == cost

    def test_full_flow_fail(self, db_session, quota_service, user_with_account):
        """冻结 → 解冻，余额恢复。"""
        uid = user_with_account.id
        cost = quota_settings.generate_image_cost

        quota_service.reserve_credit(db_session, uid, cost, "flow:2")
        quota_service.release_credit(db_session, uid, cost, "flow:2")

        account = db_session.scalar(
            select(CreditAccount).where(CreditAccount.user_id == uid)
        )
        assert account.balance == quota_settings.register_gift_amount
        assert account.frozen == 0
        assert account.total_spent == 0

    def test_multiple_tasks(self, db_session, quota_service, user_with_account):
        """多个任务并发冻结，互不影响。"""
        uid = user_with_account.id
        cost = quota_settings.generate_image_cost

        quota_service.reserve_credit(db_session, uid, cost, "multi:1")
        quota_service.reserve_credit(db_session, uid, cost, "multi:2")

        account = db_session.scalar(
            select(CreditAccount).where(CreditAccount.user_id == uid)
        )
        assert account.balance == quota_settings.register_gift_amount - cost * 2
        assert account.frozen == cost * 2

        # 第一个任务成功
        quota_service.capture_credit(db_session, uid, cost, "multi:1", cost)
        # 第二个任务失败
        quota_service.release_credit(db_session, uid, cost, "multi:2")

        account = db_session.scalar(
            select(CreditAccount).where(CreditAccount.user_id == uid)
        )
        assert account.balance == quota_settings.register_gift_amount - cost
        assert account.frozen == 0
        assert account.total_spent == cost


# ══════════════════════════════════════════════════════════════════════════════
# API 层测试
# ══════════════════════════════════════════════════════════════════════════════


class TestQuotaAPI:
    """通过 HTTP 端点测试积分模块 API。"""

    def test_get_balance(self, auth_quota_client):
        resp = auth_quota_client.get("/quota/balance")
        assert resp.status_code == 200
        data = resp.json()
        assert data["code"] == 200
        assert data["data"]["balance"] == quota_settings.register_gift_amount
        assert data["data"]["frozen"] == 0
        assert data["data"]["total_earned"] == quota_settings.register_gift_amount

    def test_get_balance_no_account(self, auth_client):
        """没有积分账户时应返回 404。"""
        resp = auth_client.get("/quota/balance")
        assert resp.status_code == 200
        data = resp.json()
        assert data["code"] == 404

    def test_list_transactions_empty(self, auth_quota_client):
        resp = auth_quota_client.get("/quota/transactions")
        assert resp.status_code == 200
        data = resp.json()
        assert data["code"] == 200
        assert data["data"] == []
        assert data["total"] == 0

    def test_list_transactions_pagination(
        self, auth_quota_client, db_session, user_with_account
    ):
        """先写入几条流水，再通过 API 分页查询。"""
        uid = user_with_account.id
        service = SqlAlchemyQuotaService()
        for i in range(5):
            service.credit(db_session, uid, 10, CreditReason.ADMIN_ADJUST, f"api:{i}")
        db_session.commit()

        resp = auth_quota_client.get("/quota/transactions?page=1&page_size=2")
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 5
        assert len(data["data"]) == 2

    def test_list_transactions_default_pagination(
        self, auth_quota_client, db_session, user_with_account
    ):
        """默认分页参数。"""
        uid = user_with_account.id
        service = SqlAlchemyQuotaService()
        service.credit(db_session, uid, 10, CreditReason.ADMIN_ADJUST, "api:def")
        db_session.commit()

        resp = auth_quota_client.get("/quota/transactions")
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 1

    def test_unauthenticated_access(self, client):
        """未登录访问应返回 401。"""
        resp = client.get("/quota/balance")
        assert resp.status_code == 200
        data = resp.json()
        assert data["code"] == 401


def _gift_account(session: Session, user_id: int) -> None:
    session.add(
        CreditAccount(
            user_id=user_id,
            balance=quota_settings.register_gift_amount,
            frozen=0,
            total_earned=quota_settings.register_gift_amount,
            total_spent=0,
        )
    )
    session.flush()


class TestInviteCode:
    """邀请码生成、查询与兑换。"""

    def test_get_invite_code_creates_when_missing(self, auth_quota_client):
        resp = auth_quota_client.get("/quota/invite/code")
        assert resp.status_code == 200
        data = resp.json()
        assert data["code"] == 200
        assert len(data["data"]["code"]) == 8
        assert data["data"]["used_count"] == 0

        again = auth_quota_client.get("/quota/invite/code")
        assert again.json()["data"]["code"] == data["data"]["code"]

    def test_generate_invite_code_rotates(self, auth_quota_client):
        first = auth_quota_client.get("/quota/invite/code").json()["data"]["code"]
        second = auth_quota_client.post("/quota/invite/generate").json()["data"]["code"]
        assert second != first
        assert len(second) == 8

    def test_redeem_invite_code_rewards_both_users(self, db_session, quota_service):
        from windup_app.server.user.model import User

        inviter = User(email="host@example.com", password_hash="x")
        invitee = User(email="guest@example.com", password_hash="x")
        db_session.add_all([inviter, invitee])
        db_session.flush()
        _gift_account(db_session, inviter.id)
        _gift_account(db_session, invitee.id)
        view = quota_service.generate_invite_code(db_session, inviter.id)

        quota_service.redeem_invite_code(db_session, invitee.id, view.code.lower())

        host = quota_service.get_account(db_session, inviter.id)
        guest = quota_service.get_account(db_session, invitee.id)
        assert (
            host.balance
            == quota_settings.register_gift_amount + quota_settings.invite_reward_amount
        )
        assert (
            guest.balance
            == quota_settings.register_gift_amount + quota_settings.invite_reward_amount
        )

    def test_redeem_rejects_own_code_and_repeat(self, db_session, quota_service):
        from windup_app.server.user.model import User
        from windup_common.exceptions import BizException

        host = User(email="self@example.com", password_hash="x")
        guest = User(email="once@example.com", password_hash="x")
        db_session.add_all([host, guest])
        db_session.flush()
        _gift_account(db_session, host.id)
        _gift_account(db_session, guest.id)
        view = quota_service.generate_invite_code(db_session, host.id)

        with pytest.raises(BizException, match="不能填写自己的邀请码"):
            quota_service.redeem_invite_code(db_session, host.id, view.code)

        quota_service.redeem_invite_code(db_session, guest.id, view.code)
        with pytest.raises(BizException, match="已填写过邀请码"):
            quota_service.redeem_invite_code(db_session, guest.id, view.code)

    def test_generate_invite_code_rejects_missing_user(self, db_session, quota_service):
        from windup_common.exceptions import BizException

        with pytest.raises(BizException, match="用户不存在"):
            quota_service.generate_invite_code(db_session, 999999)

    def test_allocate_invite_code_gives_up_on_collision(
        self, db_session, quota_service, monkeypatch
    ):
        from windup_app.server.quota import service as quota_mod
        from windup_app.server.user.model import User
        from windup_common.exceptions import BizException

        taken = User(email="taken@example.com", password_hash="x")
        host = User(email="alloc@example.com", password_hash="x")
        db_session.add_all([taken, host])
        db_session.flush()
        occupied = quota_service.generate_invite_code(db_session, taken.id)
        monkeypatch.setattr(quota_mod, "_new_invite_code", lambda: occupied.code)

        with pytest.raises(BizException, match="邀请码生成失败"):
            quota_service.generate_invite_code(db_session, host.id)

    def test_redeem_rejects_blank_or_unknown_code(self, db_session, quota_service):
        from windup_app.server.user.model import User
        from windup_common.exceptions import BizException

        guest = User(email="blank@example.com", password_hash="x")
        db_session.add(guest)
        db_session.flush()
        _gift_account(db_session, guest.id)

        with pytest.raises(BizException, match="邀请码无效"):
            quota_service.redeem_invite_code(db_session, guest.id, "   ")
        with pytest.raises(BizException, match="邀请码无效"):
            quota_service.redeem_invite_code(db_session, guest.id, "NOPE1234")

    def test_redeem_rejects_missing_invitee(self, db_session, quota_service):
        from windup_app.server.user.model import User
        from windup_common.exceptions import BizException

        host = User(email="orphan-host@example.com", password_hash="x")
        db_session.add(host)
        db_session.flush()
        _gift_account(db_session, host.id)
        view = quota_service.generate_invite_code(db_session, host.id)

        with pytest.raises(BizException, match="用户不存在"):
            quota_service.redeem_invite_code(db_session, 999999, view.code)

    def test_redeem_invite_code_endpoint(self, auth_quota_client, db_session):
        from windup_app.server.user.model import User

        host = User(email="api-host@example.com", password_hash="x")
        db_session.add(host)
        db_session.flush()
        _gift_account(db_session, host.id)
        view = SqlAlchemyQuotaService().generate_invite_code(db_session, host.id)
        db_session.commit()

        resp = auth_quota_client.post("/quota/invite/redeem", json={"code": view.code})
        assert resp.status_code == 200
        body = resp.json()
        assert body["code"] == 200
        assert body["message"] == "邀请码填写成功"
