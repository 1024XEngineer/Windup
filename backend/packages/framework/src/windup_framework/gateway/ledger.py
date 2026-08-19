from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any

from windup_framework.db import SessionLocal
from windup_framework.gateway.models import AIGatewayAttempt, AIGatewayAttemptDetail
from windup_framework.gateway.trace import AttemptTrace

logger = logging.getLogger("windup.gateway.ledger")


def _uuid(value: str | None) -> uuid.UUID:
    return uuid.UUID(value) if value else uuid.uuid4()


def _int_or_none(value: str | None) -> int | None:
    if value is None or value == "":
        return None
    return int(value)


def _dt_or_now(value: str | None) -> datetime:
    if not value:
        return datetime.now(timezone.utc)
    return datetime.fromisoformat(value)


def _cost_or_none(value: float | None) -> Decimal | None:
    if value is None:
        return None
    return Decimal(str(value))


def _ledger_outcome(value: str | None) -> str:
    if value == "fallback_success":
        return "success"
    if value in {"success", "accepted", "failed"}:
        return value
    return "failed"


def _json_or_none(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, dict | list | str | int | float | bool):
        return value
    return {"value": str(value)}


def persist_attempt(trace: AttemptTrace, *, session_factory=SessionLocal) -> None:
    """Persist one gateway attempt without letting ledger failures affect generation."""

    attempt_uuid = _uuid(trace.attempt_id)
    try:
        with session_factory() as session:
            session.add(
                AIGatewayAttempt(
                    request_id=trace.request_id,
                    attempt_id=attempt_uuid,
                    task_id=_int_or_none(trace.task_id),
                    user_id=_int_or_none(trace.user_id),
                    project_id=None,
                    scene=trace.scene.value,
                    attempt_index=trace.attempt_index or 0,
                    retry_count=trace.retry_count,
                    route_id=trace.route_id or "default.primary",
                    route_group=trace.route_group or trace.scene.value,
                    candidate_index=trace.candidate_index or 0,
                    provider_name=trace.provider_name or "openai-compatible",
                    base_url_id=trace.base_url_id or "primary",
                    base_url_host=trace.base_url_host or "",
                    api_key_id=trace.api_key_id,
                    model=trace.model,
                    family=trace.family or "",
                    route_reason=trace.route_reason or "primary",
                    route_layer=trace.route_layer or "none",
                    circuit_scope=trace.circuit_scope,
                    phase="image_sync" if trace.scene.value == "character_image" else "submit",
                    outcome=_ledger_outcome(trace.outcome),
                    job_id=trace.job_id,
                    error_type=trace.error_type,
                    http_status=trace.http_status,
                    maybe_billed=bool(trace.maybe_billed),
                    estimated_cost=_cost_or_none(trace.cost),
                    cost_currency="USD" if trace.cost is not None else None,
                    price_version=trace.price_version,
                    started_at=_dt_or_now(trace.started_at),
                    ended_at=_dt_or_now(trace.ended_at),
                    attempt_latency_ms=trace.attempt_latency_ms,
                )
            )
            session.commit()
    except Exception:
        logger.exception("Gateway hot ledger write failed request_id=%s", trace.request_id)
        return

    try:
        with session_factory() as session:
            session.add(
                AIGatewayAttemptDetail(
                    attempt_id=attempt_uuid,
                    request_id=trace.request_id,
                    task_id=_int_or_none(trace.task_id),
                    job_status=trace.job_status,
                    edge_fingerprint=trace.edge_fingerprint,
                    error_message=None,
                    provider_request_id=None,
                    provider_usage=_json_or_none(trace.provider_usage),
                    input_hash=trace.input_hash,
                    output_hash=trace.output_hash,
                    output_bytes=trace.output_bytes,
                    expected_bytes=trace.expected_bytes,
                    retry_after_ms=trace.retry_after_ms,
                    submit_ms=trace.submit_ms,
                    poll_ms=trace.poll_ms,
                    download_ms=trace.download_ms,
                    poll_count=trace.poll_count,
                    extra=None,
                )
            )
            session.commit()
    except Exception:
        logger.exception("Gateway detail ledger write failed request_id=%s", trace.request_id)
