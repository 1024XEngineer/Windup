"""积分兑换码的生成用例；明文只从运维脚本输出，不进入持久化模型。"""

from __future__ import annotations

import secrets
from datetime import datetime

from sqlalchemy import select

from windup_app.server.quota.model import CreditRedemptionCode
from windup_app.server.quota.service import redemption_code_hash

_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
_BODY_LENGTH = 12
_AMOUNT = 1000


def _format_code(body: str) -> str:
    return f"WU-{body[:4]}-{body[4:8]}-{body[8:]}"


def _new_code() -> str:
    body = "".join(secrets.choice(_ALPHABET) for _ in range(_BODY_LENGTH))
    return _format_code(body)


def create_codes(
    session, *, count: int, expires_at: datetime | None = None
) -> list[str]:
    """生成兑换码并 flush；提交事务由调用方控制。"""
    if count < 1:
        raise ValueError("count must be positive")

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
                amount=_AMOUNT,
                expires_at=expires_at,
            )
        )
    session.flush()
    return codes
