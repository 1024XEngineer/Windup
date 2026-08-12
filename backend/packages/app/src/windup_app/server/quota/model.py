"""积分模块领域模型。

与数据库表一一对应，字段名与列名保持一致。

ORM 模型
--------

::

    windup_credit_account    积分账户（每用户一行）
    windup_credit_transaction  积分流水（不可变账本）
    windup_invite_code       邀请码
    windup_invite_record     邀请记录
    windup_token_usage       Token 用量记录
"""

from dataclasses import dataclass, field
from datetime import datetime, timezone

from sqlalchemy import BigInteger, DateTime, Integer, SmallInteger, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from windup_framework.db import Base


# -- ORM ----------------------------------------------------------------


class CreditAccount(Base):
    """积分账户。"""

    __tablename__ = "windup_credit_account"

    id: Mapped[int] = mapped_column(
        BigInteger().with_variant(Integer, "sqlite"),
        primary_key=True,
        autoincrement=True,
    )
    user_id: Mapped[int] = mapped_column(
        BigInteger().with_variant(Integer, "sqlite"),
        unique=True,
        nullable=False,
    )
    balance: Mapped[int] = mapped_column(
        BigInteger().with_variant(Integer, "sqlite"),
        nullable=False,
        default=0,
    )
    frozen: Mapped[int] = mapped_column(
        BigInteger().with_variant(Integer, "sqlite"),
        nullable=False,
        default=0,
    )
    total_earned: Mapped[int] = mapped_column(
        BigInteger().with_variant(Integer, "sqlite"),
        nullable=False,
        default=0,
    )
    total_spent: Mapped[int] = mapped_column(
        BigInteger().with_variant(Integer, "sqlite"),
        nullable=False,
        default=0,
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


class CreditTransaction(Base):
    """积分流水（不可变账本）。"""

    __tablename__ = "windup_credit_transaction"
    __table_args__ = (
        UniqueConstraint("ref_id", "reason", name="uq_credit_txn_ref_reason"),
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
    delta: Mapped[int] = mapped_column(Integer, nullable=False)
    reason: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    billing_mode: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=0)
    ref_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    balance_after: Mapped[int] = mapped_column(
        BigInteger().with_variant(Integer, "sqlite"),
        nullable=False,
    )
    create_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )


# -- 以下 ORM 暂不实现（枚举 / 接口已预留）----------------------------------
#
# class InviteCode(Base):
#     """邀请码。"""
#     __tablename__ = "windup_invite_code"
#     ...
#
# class InviteRecord(Base):
#     """邀请记录。"""
#     __tablename__ = "windup_invite_record"
#     ...
#
# class TokenUsage(Base):
#     """Token 用量记录。"""
#     __tablename__ = "windup_token_usage"
#     ...


# -- 视图模型 ------------------------------------------------------------


@dataclass
class CreditAccountView:
    """积分账户视图。"""

    id: int | None = None
    user_id: int = 0
    balance: int = 0
    frozen: int = 0
    total_earned: int = 0
    total_spent: int = 0
    create_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    update_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))


@dataclass
class CreditTransactionView:
    """积分流水视图。"""

    id: int | None = None
    user_id: int = 0
    delta: int = 0
    reason: int = 0
    billing_mode: int = 0
    ref_id: str | None = None
    balance_after: int = 0
    create_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))


# -- 暂不实现 --
#
# @dataclass
# class InviteCodeView:
#     """邀请码视图。"""
#     ...
