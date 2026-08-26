"""积分领域服务的 SQLAlchemy 实现。

:class:`SqlAlchemyQuotaService` 继承 :class:`QuotaService` 接口。

事务边界由 ``windup_framework.db.get_session`` 依赖负责——成功 commit、异常
rollback，故本实现只 ``flush``（把变更发到当前事务、取回生成的主键），不 commit。

关键设计：
- 预付费（生成任务）：冻结 → 扣减/解冻，行级锁 + 幂等 ref_id
- 后付费（Agent token）：原子 UPDATE WHERE balance >= amount，无需行锁
- 入账（赠送/奖励）：余额 + 累计获得同步递增
"""

import hashlib
import logging
import re
import secrets
from datetime import datetime, timedelta, timezone
from typing import Literal

from sqlalchemy import func, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from windup_common.enums.biz_code import BizCode
from windup_common.enums.quota import BillingMode, CreditReason
from windup_common.exceptions import BizException

from windup_app.server.quota.interface import QuotaService
from windup_app.server.quota.model import (
    CreditAccount,
    CreditAccountView,
    CreditRedemptionCode,
    CreditTransaction,
    CreditTransactionView,
    InviteCode,
    InviteCodeView,
    InviteRecord,
)
from windup_app.server.user.model import User
from windup_framework.config.quota import settings as quota_settings

logger = logging.getLogger("windup.quota.service")

_INVITE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
_INVITE_CODE_LENGTH = 8
_INVITE_CODE_RE = re.compile(rf"^[{re.escape(_INVITE_ALPHABET)}]{{4,16}}$")
_REDEMPTION_CODE_RE = re.compile(r"^WU[A-Z0-9]{12}$")


def normalize_invite_code(code: str) -> str:
    return code.strip().upper()


def parse_invite_code(code: str) -> str:
    """解析邀请链接传入的邀请码，字符集与前端 INVITE_CODE_PATTERN 一致。"""
    normalized = normalize_invite_code(code)
    if _INVITE_CODE_RE.fullmatch(normalized) is None:
        raise BizException("邀请码无效", code=BizCode.BAD_REQUEST)
    return normalized


def normalize_redemption_code(code: str) -> str:
    """把展示用分隔符去掉后转成兑换码的规范形式。"""
    normalized = re.sub(r"[-\s]", "", code.strip().upper())
    if _REDEMPTION_CODE_RE.fullmatch(normalized) is None:
        raise BizException("兑换码无效或已使用", code=BizCode.BAD_REQUEST)
    return normalized


def redemption_code_hash(code: str) -> str:
    """兑换码由高熵随机串生成，摘要足以阻断数据库明文泄露。"""
    return hashlib.sha256(normalize_redemption_code(code).encode("ascii")).hexdigest()


def _new_invite_code() -> str:
    return "".join(secrets.choice(_INVITE_ALPHABET) for _ in range(_INVITE_CODE_LENGTH))


def _is_invitee_unique_violation(exc: IntegrityError) -> bool:
    text = f"{getattr(exc, 'orig', '')} {exc}".lower()
    return "invitee" in text or "windup_invite_record" in text


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _utc_day_start(now: datetime | None = None) -> datetime:
    current = now or _now()
    if current.tzinfo is None:
        current = current.replace(tzinfo=timezone.utc)
    return current.astimezone(timezone.utc).replace(
        hour=0, minute=0, second=0, microsecond=0
    )


def _is_expired(expires_at: datetime) -> bool:
    exp = expires_at if expires_at.tzinfo else expires_at.replace(tzinfo=timezone.utc)
    return exp <= _now()


def _to_invite_view(row: InviteCode) -> InviteCodeView:
    return InviteCodeView(
        code=row.code,
        used_count=row.used_count,
        expires_at=row.expires_at,
        create_at=row.create_at,
        update_at=row.update_at,
    )


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

    def _txn_for(
        self, session: Session, ref_id: str, reason: int
    ) -> CreditTransaction | None:
        return session.scalar(
            select(CreditTransaction).where(
                CreditTransaction.ref_id == ref_id,
                CreditTransaction.reason == reason,
            )
        )

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
            session,
            user_id,
            -amount,
            CreditReason.FROZEN,
            BillingMode.PREPAID,
            account.balance,
            ref_id,
        )

        logger.info(
            "[WINDUP] 积分冻结 | user_id=%s amount=%s ref_id=%s balance=%s",
            user_id,
            amount,
            ref_id,
            account.balance,
        )

    def capture_credit(
        self,
        session: Session,
        user_id: int,
        actual_amount: int,
        ref_id: str,
        frozen_amount: int,
    ) -> None:
        """预付费扣减：frozen -= frozen_amount, total_spent += actual_amount。

        若 actual_amount < frozen_amount，差额退回 balance。
        同一 ``ref_id`` 已有 CAPTURED 流水则跳过（MQ 重投幂等）。
        """
        account = self._get_account_for_update(session, user_id)
        if self._txn_for(session, ref_id, int(CreditReason.CAPTURED)) is not None:
            logger.info("[WINDUP] 积分扣减已落地，跳过 | ref_id=%s", ref_id)
            return

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
            session,
            user_id,
            -actual_amount,
            CreditReason.CAPTURED,
            BillingMode.PREPAID,
            account.balance,
            ref_id,
        )

        # 有差额退回时写退款流水（用不同 reason 区分，ref_id 加后缀去重）
        if refund > 0:
            self._write_txn(
                session,
                user_id,
                refund,
                CreditReason.REFUND,
                BillingMode.PREPAID,
                account.balance,
                f"{ref_id}:refund",
            )

        logger.info(
            "[WINDUP] 积分扣减 | user_id=%s actual=%s frozen=%s refund=%s balance=%s",
            user_id,
            actual_amount,
            frozen_amount,
            refund,
            account.balance,
        )

    def release_credit(
        self, session: Session, user_id: int, amount: int, ref_id: str
    ) -> None:
        """预付费解冻：frozen -= amount, balance += amount。

        同一 ``ref_id`` 已有解冻流水则跳过（MQ 重投幂等）。
        """
        account = self._get_account_for_update(session, user_id)
        if self._txn_for(session, f"{ref_id}:release", int(CreditReason.REFUND)) is not None:
            logger.info("[WINDUP] 积分解冻已落地，跳过 | ref_id=%s", ref_id)
            return

        if account.frozen < amount:
            raise BizException(
                f"冻结额度不足（需要 {amount}，当前冻结 {account.frozen}）",
                code=BizCode.BAD_REQUEST,
            )

        account.frozen -= amount
        account.balance += amount
        session.flush()

        self._write_txn(
            session,
            user_id,
            amount,
            CreditReason.REFUND,
            BillingMode.PREPAID,
            account.balance,
            f"{ref_id}:release",
        )

        logger.info(
            "[WINDUP] 积分解冻 | user_id=%s amount=%s ref_id=%s balance=%s",
            user_id,
            amount,
            ref_id,
            account.balance,
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
        self,
        session: Session,
        user_id: int,
        amount: int,
        reason: int,
        ref_id: str | None = None,
    ) -> None:
        """入账：balance += amount, total_earned += amount。"""
        if amount <= 0:
            return

        account = self._get_account_for_update(session, user_id)
        account.balance += amount
        account.total_earned += amount
        session.flush()

        self._write_txn(
            session,
            user_id,
            amount,
            reason,
            BillingMode.PREPAID,
            account.balance,
            ref_id,
        )

        logger.info(
            "[WINDUP] 积分入账 | user_id=%s amount=%s reason=%s balance=%s",
            user_id,
            amount,
            reason,
            account.balance,
        )

    def redeem_code(
        self, session: Session, user_id: int, code: str
    ) -> tuple[int, CreditAccountView]:
        """原子占用兑换码并将额度写入不可变积分账本。"""
        code_hash = redemption_code_hash(code)
        account = self._get_account_for_update(session, user_id)
        redemption = session.scalar(
            select(CreditRedemptionCode).where(
                CreditRedemptionCode.code_hash == code_hash
            )
        )
        if redemption is None:
            raise BizException("兑换码无效或已使用", code=BizCode.BAD_REQUEST)
        if redemption.expires_at is not None and _is_expired(redemption.expires_at):
            raise BizException("兑换码无效或已使用", code=BizCode.BAD_REQUEST)

        ref_id = f"redemption:{redemption.id}"
        if redemption.redeemed_by is not None:
            if (
                redemption.redeemed_by == user_id
                and self._txn_for(session, ref_id, int(CreditReason.REDEMPTION))
                is not None
            ):
                return redemption.amount, _to_account_view(account)
            raise BizException("兑换码无效或已使用", code=BizCode.BAD_REQUEST)

        redeemed_at = _now()
        claimed = session.execute(
            update(CreditRedemptionCode)
            .where(
                CreditRedemptionCode.id == redemption.id,
                CreditRedemptionCode.redeemed_by.is_(None),
                or_(
                    CreditRedemptionCode.expires_at.is_(None),
                    CreditRedemptionCode.expires_at > redeemed_at,
                ),
            )
            .values(redeemed_by=user_id, redeemed_at=redeemed_at)
        )
        if claimed.rowcount != 1:
            raise BizException("兑换码无效或已使用", code=BizCode.BAD_REQUEST)
        session.expire(redemption, ["redeemed_by", "redeemed_at"])
        account.balance += redemption.amount
        account.total_earned += redemption.amount
        session.flush()
        self._write_txn(
            session,
            user_id,
            redemption.amount,
            CreditReason.REDEMPTION,
            BillingMode.PREPAID,
            account.balance,
            ref_id,
        )
        logger.info(
            "[WINDUP] 兑换码入账 | user_id=%s redemption_id=%s amount=%s balance=%s",
            user_id,
            redemption.id,
            redemption.amount,
            account.balance,
        )
        return redemption.amount, _to_account_view(account)

    # -- 流水查询 ---------------------------------------------------------

    def list_transactions(
        self,
        session: Session,
        user_id: int,
        page: int = 1,
        page_size: int = 20,
        *,
        direction: Literal["income", "expense"] | None = None,
        reason: int | None = None,
        created_from: datetime | None = None,
        created_before: datetime | None = None,
    ) -> tuple[list[CreditTransactionView], int]:
        """筛选并分页查询积分流水。"""
        conditions = [CreditTransaction.user_id == user_id]
        if direction == "income":
            conditions.append(CreditTransaction.delta > 0)
        elif direction == "expense":
            conditions.append(CreditTransaction.delta < 0)
        if reason is not None:
            conditions.append(CreditTransaction.reason == reason)
        if created_from is not None:
            conditions.append(CreditTransaction.create_at >= created_from)
        if created_before is not None:
            conditions.append(CreditTransaction.create_at < created_before)

        total = session.scalar(
            select(func.count())
            .select_from(CreditTransaction)
            .where(*conditions)
        )

        rows = session.scalars(
            select(CreditTransaction)
            .where(*conditions)
            .order_by(CreditTransaction.id.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        ).all()

        return [_to_txn_view(r) for r in rows], total or 0

    # -- 邀请码 -----------------------------------------------------------

    def get_invite_code(self, session: Session, user_id: int) -> InviteCodeView:
        row = session.scalar(
            select(InviteCode)
            .where(InviteCode.user_id == user_id, InviteCode.expires_at > _now())
            .order_by(InviteCode.id.desc())
        )
        if row is not None:
            return _to_invite_view(row)
        return self.generate_invite_code(session, user_id)

    def generate_invite_code(self, session: Session, user_id: int) -> InviteCodeView:
        if session.get(User, user_id) is None:
            raise BizException("用户不存在", code=BizCode.NOT_FOUND)

        now = _now()
        existing = session.scalars(
            select(InviteCode)
            .where(InviteCode.user_id == user_id)
            .with_for_update()
        ).all()
        for row in existing:
            if not _is_expired(row.expires_at):
                row.expires_at = now

        row = InviteCode(
            user_id=user_id,
            code=self._allocate_invite_code(session),
            used_count=0,
            expires_at=now
            + timedelta(days=quota_settings.invite_code_ttl_days),
        )
        session.add(row)
        session.flush()
        logger.info("[WINDUP] 生成邀请码 | user_id=%s code=%s", user_id, row.code)
        return _to_invite_view(row)

    def _allocate_invite_code(self, session: Session) -> str:
        for _ in range(16):
            code = _new_invite_code()
            if session.scalar(select(InviteCode.id).where(InviteCode.code == code)) is None:
                return code
        raise BizException("邀请码生成失败，请稍后重试", code=BizCode.BAD_REQUEST)

    def require_active_invite(self, session: Session, code: str) -> InviteCode:
        normalized = parse_invite_code(code)
        invite = session.scalar(
            select(InviteCode).where(InviteCode.code == normalized)
        )
        if invite is None:
            raise BizException("邀请码无效", code=BizCode.BAD_REQUEST)
        if _is_expired(invite.expires_at):
            raise BizException("邀请码已过期", code=BizCode.NOT_FOUND)
        return invite

    def redeem_invite_code(self, session: Session, user_id: int, code: str) -> None:
        invite = self.require_active_invite(session, code)
        if invite.user_id == user_id:
            raise BizException("不能填写自己的邀请码", code=BizCode.BAD_REQUEST)
        if session.get(User, user_id) is None:
            raise BizException("用户不存在", code=BizCode.NOT_FOUND)

        existing = session.scalar(
            select(InviteRecord.id).where(InviteRecord.invitee_id == user_id)
        )
        if existing is not None:
            raise BizException("已填写过邀请码", code=BizCode.BAD_REQUEST)

        self._get_account_for_update(session, invite.user_id)

        record = InviteRecord(
            inviter_id=invite.user_id,
            invitee_id=user_id,
            code=invite.code,
        )
        session.add(record)
        invite.used_count += 1
        try:
            session.flush()
        except IntegrityError as exc:
            if _is_invitee_unique_violation(exc):
                raise BizException("已填写过邀请码", code=BizCode.BAD_REQUEST) from exc
            raise

        reward = quota_settings.invite_reward_amount
        today_count = session.scalar(
            select(func.count())
            .select_from(InviteRecord)
            .where(
                InviteRecord.inviter_id == invite.user_id,
                InviteRecord.create_at >= _utc_day_start(),
            )
        ) or 0
        if today_count <= quota_settings.invite_reward_daily_limit:
            self.credit(
                session,
                invite.user_id,
                reward,
                int(CreditReason.INVITE_REWARD),
                f"invite:{user_id}:inviter",
            )
        else:
            logger.info(
                "[WINDUP] 邀请人日限额已满，跳过邀请人奖励 | inviter=%s invitee=%s count=%s",
                invite.user_id,
                user_id,
                today_count,
            )
        self.credit(
            session,
            user_id,
            reward,
            int(CreditReason.INVITE_REWARD),
            f"invite:{user_id}:invitee",
        )
        logger.info(
            "[WINDUP] 兑换邀请码 | invitee=%s inviter=%s code=%s",
            user_id,
            invite.user_id,
            invite.code,
        )


service = SqlAlchemyQuotaService()
