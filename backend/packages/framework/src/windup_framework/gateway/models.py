"""Gateway attempt ledger ORM models.

The hot/cold split keeps route health and cost attribution queries on a compact
table, while larger troubleshooting payloads live in the detail table.
"""

from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from uuid import UUID

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    DateTime,
    Index,
    Integer,
    JSON,
    Numeric,
    String,
    Text,
    Uuid,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from windup_framework.db import Base


_BIGINT = BigInteger().with_variant(Integer, "sqlite")
_JSONB = JSON().with_variant(JSONB, "postgresql")


class AIGatewayAttempt(Base):
    """Hot ledger row for one gateway attempt.

    One row represents one actual attempt against a model/key/base_url candidate.
    It intentionally stores only compact routing, outcome, and cost fields.
    """

    __tablename__ = "windup_ai_gateway_attempt"
    __table_args__ = (
        CheckConstraint(
            "scene IN ('character_image', 'character_action')",
            name="ck_gateway_attempt_scene",
        ),
        CheckConstraint(
            "phase IN ('image_sync', 'submit', 'follow', 'download')",
            name="ck_gateway_attempt_phase",
        ),
        CheckConstraint(
            "route_layer IN ('none', 'model', 'key', 'base_url')",
            name="ck_gateway_attempt_route_layer",
        ),
        CheckConstraint(
            "outcome IN ('success', 'accepted', 'failed')",
            name="ck_gateway_attempt_outcome",
        ),
        CheckConstraint(
            "http_status IS NULL OR (http_status >= 100 AND http_status <= 599)",
            name="ck_gateway_attempt_http_status",
        ),
        CheckConstraint(
            "estimated_cost IS NULL OR estimated_cost >= 0",
            name="ck_gateway_attempt_cost_non_negative",
        ),
        CheckConstraint(
            "attempt_index >= 0 "
            "AND retry_count >= 0 "
            "AND candidate_index >= 0 "
            "AND (attempt_latency_ms IS NULL OR attempt_latency_ms >= 0)",
            name="ck_gateway_attempt_non_negative_counts",
        ),
        Index("ix_gateway_attempt_request", "request_id", "attempt_index"),
        Index("ix_gateway_attempt_task", "task_id", "scene", "created_at"),
        Index(
            "ix_gateway_attempt_provider_error",
            "provider_name",
            "base_url_id",
            "error_type",
            "created_at",
        ),
        Index(
            "ix_gateway_attempt_key_error",
            "provider_name",
            "base_url_id",
            "api_key_id",
            "error_type",
            "created_at",
        ),
        Index("ix_gateway_attempt_model_error", "model", "error_type", "created_at"),
        Index(
            "ix_gateway_attempt_route_health",
            "route_group",
            "route_id",
            "outcome",
            "created_at",
        ),
        Index("ix_gateway_attempt_maybe_billed", "maybe_billed", "outcome", "created_at"),
        Index("ix_gateway_attempt_job", "job_id"),
    )

    id: Mapped[int] = mapped_column(_BIGINT, primary_key=True, autoincrement=True)
    request_id: Mapped[str] = mapped_column(String(96), nullable=False)
    attempt_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), unique=True, nullable=False)

    task_id: Mapped[int | None] = mapped_column(_BIGINT, nullable=True)
    user_id: Mapped[int | None] = mapped_column(_BIGINT, nullable=True)
    project_id: Mapped[int | None] = mapped_column(_BIGINT, nullable=True)
    scene: Mapped[str] = mapped_column(Text, nullable=False)

    attempt_index: Mapped[int] = mapped_column(Integer, nullable=False)
    retry_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    route_id: Mapped[str] = mapped_column(Text, nullable=False)
    route_group: Mapped[str] = mapped_column(Text, nullable=False)
    candidate_index: Mapped[int] = mapped_column(Integer, nullable=False)

    provider_name: Mapped[str] = mapped_column(Text, nullable=False)
    base_url_id: Mapped[str] = mapped_column(Text, nullable=False)
    base_url_host: Mapped[str] = mapped_column(Text, nullable=False)
    api_key_id: Mapped[str | None] = mapped_column(Text, nullable=True)

    model: Mapped[str] = mapped_column(Text, nullable=False)
    family: Mapped[str] = mapped_column(Text, nullable=False)

    route_reason: Mapped[str] = mapped_column(Text, nullable=False)
    route_layer: Mapped[str] = mapped_column(Text, nullable=False, default="none")
    circuit_scope: Mapped[str | None] = mapped_column(Text, nullable=True)
    phase: Mapped[str] = mapped_column(Text, nullable=False)
    outcome: Mapped[str] = mapped_column(Text, nullable=False)

    job_id: Mapped[str | None] = mapped_column(Text, nullable=True)

    error_type: Mapped[str | None] = mapped_column(Text, nullable=True)
    http_status: Mapped[int | None] = mapped_column(Integer, nullable=True)

    maybe_billed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    estimated_cost: Mapped[Decimal | None] = mapped_column(Numeric(14, 6), nullable=True)
    cost_currency: Mapped[str | None] = mapped_column(String(8), nullable=True)
    price_version: Mapped[str | None] = mapped_column(Text, nullable=True)

    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    attempt_latency_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )


class AIGatewayAttemptDetail(Base):
    """Cold troubleshooting row for one gateway attempt."""

    __tablename__ = "windup_ai_gateway_attempt_detail"
    __table_args__ = (
        CheckConstraint(
            "(output_bytes IS NULL OR output_bytes >= 0) "
            "AND (expected_bytes IS NULL OR expected_bytes >= 0) "
            "AND (retry_after_ms IS NULL OR retry_after_ms >= 0) "
            "AND (submit_ms IS NULL OR submit_ms >= 0) "
            "AND (poll_ms IS NULL OR poll_ms >= 0) "
            "AND (download_ms IS NULL OR download_ms >= 0) "
            "AND (poll_count IS NULL OR poll_count >= 0)",
            name="ck_gateway_attempt_detail_non_negative_counts",
        ),
        Index("ix_gateway_attempt_detail_request", "request_id"),
        Index("ix_gateway_attempt_detail_task", "task_id", "created_at"),
        Index("ix_gateway_attempt_detail_job_status", "job_status", "created_at"),
    )

    id: Mapped[int] = mapped_column(_BIGINT, primary_key=True, autoincrement=True)
    attempt_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), unique=True, nullable=False)
    request_id: Mapped[str] = mapped_column(String(96), nullable=False)
    task_id: Mapped[int | None] = mapped_column(_BIGINT, nullable=True)

    job_status: Mapped[str | None] = mapped_column(Text, nullable=True)
    edge_fingerprint: Mapped[str | None] = mapped_column(Text, nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    provider_request_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    provider_usage: Mapped[dict | None] = mapped_column(_JSONB, nullable=True)

    input_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    output_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    output_bytes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    expected_bytes: Mapped[int | None] = mapped_column(Integer, nullable=True)

    retry_after_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    submit_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    poll_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    download_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    poll_count: Mapped[int | None] = mapped_column(Integer, nullable=True)

    extra: Mapped[dict | None] = mapped_column(_JSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )
