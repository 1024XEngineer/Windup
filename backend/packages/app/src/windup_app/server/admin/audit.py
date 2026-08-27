"""管理员操作审计模型与安全写入边界。"""

from datetime import datetime, timezone
from typing import Any

from sqlalchemy import BigInteger, DateTime, ForeignKey, Integer, JSON, String
from sqlalchemy.orm import Mapped, Session, mapped_column

from windup_framework.db import Base


def _bigint_type():
    return BigInteger().with_variant(Integer, "sqlite")


class AdminAuditLog(Base):
    __tablename__ = "windup_admin_audit_log"

    id: Mapped[int] = mapped_column(_bigint_type(), primary_key=True, autoincrement=True)
    admin_user_id: Mapped[int | None] = mapped_column(
        _bigint_type(),
        ForeignKey("windup_admin_user.id", ondelete="SET NULL"),
        index=True,
    )
    actor_email: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    action: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    resource_type: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    resource_id: Mapped[str | None] = mapped_column(String(128))
    result: Mapped[str] = mapped_column(String(32), nullable=False)
    reason: Mapped[str | None] = mapped_column(String(512))
    before_summary: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    after_summary: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    request_id: Mapped[str | None] = mapped_column(String(128), index=True)
    ip_address: Mapped[str | None] = mapped_column(String(64))
    user_agent: Mapped[str | None] = mapped_column(String(512))
    create_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )


_SENSITIVE_KEY_PARTS = (
    "password",
    "token",
    "secret",
    "api_key",
    "authorization",
    "cookie",
    "redemption_code",
)


def _redact(value: Any, *, key: str = "") -> Any:
    normalized = key.strip().lower()
    if any(part in normalized for part in _SENSITIVE_KEY_PARTS):
        return "[REDACTED]"
    if isinstance(value, dict):
        return {str(item_key): _redact(item, key=str(item_key)) for item_key, item in value.items()}
    if isinstance(value, list):
        return [_redact(item) for item in value]
    return value


def record_admin_audit(
    session: Session,
    *,
    admin_user_id: int | None,
    actor_email: str,
    action: str,
    resource_type: str,
    resource_id: str | None,
    result: str,
    reason: str | None = None,
    before_summary: dict[str, Any] | None = None,
    after_summary: dict[str, Any] | None = None,
    request_id: str | None = None,
    ip_address: str | None = None,
    user_agent: str | None = None,
) -> AdminAuditLog:
    row = AdminAuditLog(
        admin_user_id=admin_user_id,
        actor_email=actor_email,
        action=action,
        resource_type=resource_type,
        resource_id=resource_id,
        result=result,
        reason=reason,
        before_summary=_redact(before_summary) if before_summary is not None else None,
        after_summary=_redact(after_summary) if after_summary is not None else None,
        request_id=request_id,
        ip_address=ip_address,
        user_agent=user_agent,
    )
    session.add(row)
    session.flush()
    return row
