"""全局 MQ 消息台账 + 事务性 outbox。"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, SmallInteger, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.types import JSON

from windup_framework.db import Base


class MqMessage(Base):
    """跨 Stream 的消息投递台账。"""

    __tablename__ = "windup_mq_message"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    dedupe_key: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    stream: Mapped[str] = mapped_column(String(128), nullable=False)
    msg_type: Mapped[str] = mapped_column(String(64), nullable=False)
    payload: Mapped[dict] = mapped_column(JSON().with_variant(JSONB, "postgresql"), nullable=False, default=dict)

    publish_status: Mapped[str] = mapped_column(String(16), nullable=False, default="pending")
    publish_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    publish_attempts: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=0)
    stream_id: Mapped[str | None] = mapped_column(String(64), nullable=True)

    consume_status: Mapped[str | None] = mapped_column(String(16), nullable=True)
    consume_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    consume_attempts: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=0)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc),
    )
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    consumed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc),
    )
