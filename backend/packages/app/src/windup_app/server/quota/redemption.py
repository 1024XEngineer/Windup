"""积分兑换码的生成用例；明文只从运维脚本输出，不进入持久化模型。"""

from __future__ import annotations

import secrets
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Literal

from sqlalchemy import select
from sqlalchemy.orm import Session

from windup_common.exceptions import BizException
from windup_app.server.quota.model import CreditRedemptionCode
from windup_app.server.quota.service import redemption_code_hash

_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
_BODY_LENGTH = 12

RedemptionCodeStatus = Literal[
    "valid",
    "redeemed",
    "expired",
    "not_found",
    "invalid_format",
]


@dataclass(frozen=True)
class RedemptionCodeInspection:
    """兑换码的只读状态视图。"""

    status: RedemptionCodeStatus
    amount: int | None = None
    expires_at: datetime | None = None
    redeemed_at: datetime | None = None


def _format_code(body: str) -> str:
    return f"WU-{body[:4]}-{body[4:8]}-{body[8:]}"


def _new_code() -> str:
    body = "".join(secrets.choice(_ALPHABET) for _ in range(_BODY_LENGTH))
    return _format_code(body)


def create_codes(
    session,
    *,
    count: int,
    amount: int = 1000,
    expires_at: datetime | None = None,
) -> list[str]:
    """生成兑换码并 flush；提交事务由调用方控制。"""
    if count < 1:
        raise ValueError("count must be positive")
    if amount < 1:
        raise ValueError("amount must be positive")

    codes: list[str] = []
    hashes: set[str] = set()
    while len(codes) < count:
        code = _new_code()
        digest = redemption_code_hash(code)
        if digest in hashes:
            continue
        if (
            session.scalar(
                select(CreditRedemptionCode.id).where(
                    CreditRedemptionCode.code_hash == digest
                )
            )
            is not None
        ):
            continue
        hashes.add(digest)
        codes.append(code)
        session.add(
            CreditRedemptionCode(
                code_hash=digest,
                amount=amount,
                expires_at=expires_at,
            )
        )
    session.flush()
    return codes


def _utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def inspect_code(
    session: Session,
    code: str,
    *,
    now: datetime | None = None,
) -> RedemptionCodeInspection:
    """只读查询兑换码状态，不锁行、不 flush，也不更新任何字段。"""
    try:
        digest = redemption_code_hash(code)
    except BizException:
        return RedemptionCodeInspection(status="invalid_format")

    row = session.scalar(
        select(CreditRedemptionCode).where(CreditRedemptionCode.code_hash == digest)
    )
    if row is None:
        return RedemptionCodeInspection(status="not_found")

    current = _utc(now or datetime.now(timezone.utc))
    if row.redeemed_by is not None:
        status: RedemptionCodeStatus = "redeemed"
    elif row.expires_at is not None and _utc(row.expires_at) <= current:
        status = "expired"
    else:
        status = "valid"
    return RedemptionCodeInspection(
        status=status,
        amount=row.amount,
        expires_at=_utc(row.expires_at) if row.expires_at is not None else None,
        redeemed_at=_utc(row.redeemed_at) if row.redeemed_at is not None else None,
    )
