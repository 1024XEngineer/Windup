"""积分领域服务的 SQLAlchemy 实现。

:class:`SqlAlchemyQuotaService` 继承 :class:`QuotaService` 接口。

事务边界由 ``windup_framework.db.get_session`` 依赖负责——成功 commit、异常
rollback，故本实现只 ``flush``（把变更发到当前事务、取回生成的主键），不 commit。

关键设计：
- 预付费（生成任务）：冻结 → 扣减/解冻，行级锁 + 幂等 ref_id
- 后付费（Agent token）：原子 UPDATE WHERE balance >= amount，无需行锁
- 入账（赠送/奖励）：余额 + 累计获得同步递增
"""

import logging

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from windup_common.enums.biz_code import BizCode
from windup_common.enums.quota import BillingMode, CreditReason
from windup_common.exceptions import BizException

from windup_app.server.quota.interface import QuotaService
from windup_app.server.quota.model import (
    CreditAccount,
    CreditAccountView,
    CreditTransaction,
    CreditTransactionView,
)

logger = logging.getLogger("windup.quota.service")


def _to_account_view(account: CreditAccount) -> CreditAccountView:
    return CreditAccountView(
        id=account.id,
        user_id=account.user_id,
        balance=account.balance,
        frozen=account.frozen,
        total_earned=account.total_earned,
        total_spent=account.total_spent,
        create_at=account.create_at,
        update_at=account.update_at,
    )


def _to_txn_view(txn: CreditTransaction) -> CreditTransactionView:
    return CreditTransactionView(
        id=txn.id,
        user_id=txn.user_id,
        delta=txn.delta,
        reason=txn.reason,
        billing_mode=txn.billing_mode,
        ref_id=txn.ref_id,
        balance_after=txn.balance_after,
        create_at=txn.create_at,
    )


class SqlAlchemyQuotaService(QuotaService):
    """基于 SQLAlchemy session 的积分服务实现。"""

    # -- 账户 ------------------------------------------------------------

    def get_account(self, session: Session, user_id: int) -> CreditAccountView | None:
        account = session.scalar(
            select(CreditAccount).where(CreditAccount.user_id == user_id)
        )
        return _to_account_view(account) if account else None

    def _get_account_for_update(self, session: Session, user_id: int) -> CreditAccount:
        """SELECT ... FOR UPDATE 锁定账户行。"""
        account = session.scalar(
            select(CreditAccount)
            .where(CreditAccount.user_id == user_id)
            .with_for_update()
        )
        if account is None:
            raise BizException("积分账户不存在", code=BizCode.NOT_FOUND)
        return account

    def _write_txn(
        self,
        session: Session,
        user_id: int,
        delta: int,
        reason: int,
        billing_mode: int,
        balance_after: int,
        ref_id: str | None = None,
    ) -> CreditTransaction:
        """写入一条流水记录。"""
        txn = CreditTransaction(
            user_id=user_id,
            delta=delta,
            reason=reason,
            billing_mode=billing_mode,
            ref_id=ref_id,
            balance_after=balance_after,
        )
        session.add(txn)
        return txn

    # -- 预付费：冻结 / 扣减 / 解冻 ----------------------------------------

    def reserve_credit(
        self, session: Session, user_id: int, amount: int, ref_id: str
    ) -> None:
        """预付费冻结：balance -= amount, frozen += amount。"""
        account = self._get_account_for_update(session, user_id)

        if account.balance < amount:
            raise BizException(
                f"积分不足（需要 {amount}，当前 {account.balance}）",
                code=BizCode.BAD_REQUEST,
            )

        account.balance -= amount
        account.frozen += amount
        session.flush()

        self._write_txn(
            session, user_id, -amount, CreditReason.FROZEN,
            BillingMode.PREPAID, account.balance, ref_id,
        )

        logger.info(
            "[WINDUP] 积分冻结 | user_id=%s amount=%s ref_id=%s balance=%s",
            user_id, amount, ref_id, account.balance,
        )

    def capture_credit(
        self, session: Session, user_id: int, actual_amount: int, ref_id: str, frozen_amount: int
    ) -> None:
        """预付费扣减：frozen -= frozen_amount, total_spent += actual_amount。

        若 actual_amount < frozen_amount，差额退回 balance。
        """
        account = self._get_account_for_update(session, user_id)

        if account.frozen < frozen_amount:
            raise BizException(
                f"冻结额度不足（需要 {frozen_amount}，当前冻结 {account.frozen}）",
                code=BizCode.BAD_REQUEST,
            )

        # 冻结释放
        account.frozen -= frozen_amount
        # 实际消耗
        account.total_spent += actual_amount

        # 差额退回
        refund = frozen_amount - actual_amount
        if refund > 0:
            account.balance += refund

        session.flush()

        # 写扣减流水
        self._write_txn(
            session, user_id, -actual_amount, CreditReason.CAPTURED,
            BillingMode.PREPAID, account.balance, ref_id,
        )

        # 有差额退回时写退款流水（用不同 reason 区分，ref_id 加后缀去重）
        if refund > 0:
            self._write_txn(
                session, user_id, refund, CreditReason.REFUND,
                BillingMode.PREPAID, account.balance, f"{ref_id}:refund",
            )

        logger.info(
            "[WINDUP] 积分扣减 | user_id=%s actual=%s frozen=%s refund=%s balance=%s",
            user_id, actual_amount, frozen_amount, refund, account.balance,
        )

    def release_credit(
        self, session: Session, user_id: int, amount: int, ref_id: str
    ) -> None:
        """预付费解冻：frozen -= amount, balance += amount。"""
        account = self._get_account_for_update(session, user_id)

        if account.frozen < amount:
            raise BizException(
                f"冻结额度不足（需要 {amount}，当前冻结 {account.frozen}）",
                code=BizCode.BAD_REQUEST,
            )

        account.frozen -= amount
        account.balance += amount
        session.flush()

        self._write_txn(
            session, user_id, amount, CreditReason.REFUND,
            BillingMode.PREPAID, account.balance, f"{ref_id}:release",
        )

        logger.info(
            "[WINDUP] 积分解冻 | user_id=%s amount=%s ref_id=%s balance=%s",
            user_id, amount, ref_id, account.balance,
        )

    # -- 后付费：原子扣减（暂不实现，AGENT_TOKEN / POSTPAID 枚举已预留）------
    #
    # def deduct_postpaid(
    #     self, session: Session, user_id: int, amount: int, ref_id: str
    # ) -> None:
    #     """后付费原子扣减：UPDATE ... WHERE balance >= amount。"""
    #     ...

    # -- 入账（赠送 / 奖励 / 管理员调整）----------------------------------

    def credit(
        self, session: Session, user_id: int, amount: int, reason: int, ref_id: str | None = None
    ) -> None:
        """入账：balance += amount, total_earned += amount。"""
        if amount <= 0:
            return

        account = self._get_account_for_update(session, user_id)
        account.balance += amount
        account.total_earned += amount
        session.flush()

        self._write_txn(
            session, user_id, amount, reason,
            BillingMode.PREPAID, account.balance, ref_id,
        )

        logger.info(
            "[WINDUP] 积分入账 | user_id=%s amount=%s reason=%s balance=%s",
            user_id, amount, reason, account.balance,
        )

    # -- 流水查询 ---------------------------------------------------------

    def list_transactions(
        self, session: Session, user_id: int, page: int = 1, page_size: int = 20
    ) -> tuple[list[CreditTransactionView], int]:
        """分页查询积分流水。"""
        total = session.scalar(
            select(func.count())
            .select_from(CreditTransaction)
            .where(CreditTransaction.user_id == user_id)
        )

        rows = session.scalars(
            select(CreditTransaction)
            .where(CreditTransaction.user_id == user_id)
            .order_by(CreditTransaction.id.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        ).all()

        return [_to_txn_view(r) for r in rows], total or 0

    # -- 邀请码（暂不实现）-------------------------------------------------
    # TODO: get_invite_code / generate_invite_code / redeem_invite_code


service = SqlAlchemyQuotaService()
