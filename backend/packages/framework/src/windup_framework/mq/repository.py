"""MqMessage 数据访问。"""

from __future__ import annotations

import enum
import uuid
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from windup_framework.mq.config import CONSUME_LEASE_SECONDS
from windup_framework.mq.model import MqMessage

_ERROR_MAX_LEN = 2048


class ConsumeClaimResult(enum.Enum):
    """消费认领结果。"""

    ALREADY_DONE = "already_done"
    IN_FLIGHT = "in_flight"
    CLAIMED = "claimed"


def _truncate_error(message: str | None) -> str | None:
    if message is None:
        return None
    if len(message) <= _ERROR_MAX_LEN:
        return message
    return message[: _ERROR_MAX_LEN - 3] + "..."


def get_by_id(session: Session, message_id: uuid.UUID) -> MqMessage | None:
    return session.get(MqMessage, message_id)


def get_by_dedupe_key(session: Session, dedupe_key: str) -> MqMessage | None:
    return session.scalar(select(MqMessage).where(MqMessage.dedupe_key == dedupe_key))


def insert_pending(
    session: Session,
    *,
    message_id: uuid.UUID,
    dedupe_key: str,
    stream: str,
    msg_type: str,
    payload: dict,
) -> MqMessage:
    row = MqMessage(
        id=message_id,
        dedupe_key=dedupe_key,
        stream=stream,
        msg_type=msg_type,
        payload=payload,
        publish_status="pending",
    )
    session.add(row)
    session.flush()
    return row


def list_pending(session: Session, *, limit: int = 100) -> list[MqMessage]:
    stmt = (
        select(MqMessage)
        .where(MqMessage.publish_status == "pending")
        .order_by(MqMessage.created_at.asc())
        .limit(limit)
    )
    return list(session.scalars(stmt).all())


def mark_published(
    session: Session,
    message_id: uuid.UUID,
    stream_id: str,
) -> None:
    row = session.get(MqMessage, message_id)
    if row is None:
        return
    now = datetime.now(timezone.utc)
    row.publish_status = "published"
    row.stream_id = stream_id
    row.published_at = row.published_at or now
    row.publish_error = None
    row.updated_at = now
    session.flush()


def mark_publish_failed(
    session: Session,
    message_id: uuid.UUID,
    error: str,
    *,
    terminal: bool = False,
) -> None:
    row = session.get(MqMessage, message_id)
    if row is None:
        return
    now = datetime.now(timezone.utc)
    row.publish_attempts += 1
    row.publish_error = _truncate_error(error)
    if terminal:
        row.publish_status = "failed"
    row.updated_at = now
    session.flush()


def try_claim_for_consume(
    session: Session,
    message_id: uuid.UUID,
    *,
    lease_seconds: int = CONSUME_LEASE_SECONDS,
) -> ConsumeClaimResult:
    """原子认领台账消息，避免重复 Stream 条目并发跑 handler。"""
    row = session.get(MqMessage, message_id, with_for_update=True)
    if row is None:
        return ConsumeClaimResult.ALREADY_DONE

    if row.consume_status in ("acked", "failed"):
        return ConsumeClaimResult.ALREADY_DONE

    now = datetime.now(timezone.utc)
    if row.consume_status == "processing":
        updated = row.updated_at
        if updated is not None and updated.tzinfo is None:
            updated = updated.replace(tzinfo=timezone.utc)
        if updated is not None and (now - updated).total_seconds() < lease_seconds:
            return ConsumeClaimResult.IN_FLIGHT

    row.consume_status = "processing"
    row.consume_attempts += 1
    row.updated_at = now
    session.flush()
    return ConsumeClaimResult.CLAIMED


def mark_consumed(
    session: Session,
    message_id: uuid.UUID,
    status: str,
    *,
    error: str | None = None,
) -> None:
    row = session.get(MqMessage, message_id)
    if row is None:
        return
    now = datetime.now(timezone.utc)
    row.consume_status = status
    row.consume_error = _truncate_error(error)
    row.consumed_at = row.consumed_at or now
    row.updated_at = now
    session.flush()


def release_processing_claim(session: Session, message_id: uuid.UUID) -> None:
    """handler 失败且未达上限时释放 processing，便于 PEL 重试再次认领。"""
    row = session.get(MqMessage, message_id)
    if row is None or row.consume_status != "processing":
        return
    row.consume_status = None
    row.updated_at = datetime.now(timezone.utc)
    session.flush()
