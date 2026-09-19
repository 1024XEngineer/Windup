from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any

from windup_framework.db import SessionLocal
from windup_framework.gateway.models import AIGatewayAttempt, AIGatewayAttemptDetail
from windup_framework.gateway.routes import route_layer_for
from windup_framework.gateway.trace import AttemptDetail, AttemptTrace

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


def _phase_for(trace: AttemptTrace) -> str:
    if trace.scene.value == "chat":
        return "chat_sync"
    if trace.scene.value == "character_image":
        return "image_sync"
    return "submit"


def _json_or_none(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, dict | list | str | int | float | bool):
        return value
    return {"value": str(value)}


#: 落库的提示词正文长度上限。当前正文约 1–2KB,留足余量。
_PROMPT_MAX_CHARS = 8000


def _audit_extra(detail: AttemptDetail) -> dict | None:
    extra: dict[str, object] = {}
    if detail.policy_next_step:
        extra["policy_next_step"] = detail.policy_next_step
    if detail.upstream_reached:
        extra["upstream_reached"] = detail.upstream_reached
    if detail.model_index is not None:
        extra["model_index"] = detail.model_index
    if detail.finish_reason:
        extra["finish_reason"] = detail.finish_reason
    if detail.has_tool_calls is not None:
        extra["has_tool_calls"] = detail.has_tool_calls
    if detail.prompt:
        # 截断而不是整条存:提示词正文约 1–2KB,而一次生成会记多跳(429 换 key 时更多)。
        # 上限取得比正文长,截断实际不会发生;它防的是将来某次把整本 md 塞进提示词。
        extra["prompt"] = detail.prompt[:_PROMPT_MAX_CHARS]
    return extra or None


def persist_attempt(trace: AttemptTrace, *, session_factory=SessionLocal) -> None:
    """Persist one gateway attempt without letting ledger failures affect generation."""

    attempt_uuid = _uuid(trace.attempt_id)
    route = trace.route
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
                    route_id=route.route_id,
                    route_group=route.route_group,
                    candidate_index=route.candidate_index,
                    provider_name=route.provider_name,
                    base_url_id=route.base_url_id,
                    base_url_host=route.host or "",
                    api_key_id=route.api_key_id,
                    model=trace.model,
                    family=trace.family or "",
                    route_reason=trace.route_reason or "primary",
                    route_layer=route_layer_for(trace.route_reason),
                    circuit_scope=trace.circuit_scope,
                    phase=_phase_for(trace),
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

    detail = trace.detail or AttemptDetail()
    try:
        with session_factory() as session:
            session.add(
                AIGatewayAttemptDetail(
                    attempt_id=attempt_uuid,
                    request_id=trace.request_id,
                    task_id=_int_or_none(trace.task_id),
                    job_status=detail.job_status,
                    edge_fingerprint=detail.edge_fingerprint,
                    error_message=(
                        detail.error_message[:2000] if detail.error_message else None
                    ),
                    provider_request_id=None,
                    provider_usage=_json_or_none(detail.provider_usage),
                    input_hash=detail.input_hash,
                    output_hash=detail.output_hash,
                    output_bytes=detail.output_bytes,
                    expected_bytes=detail.expected_bytes,
                    retry_after_ms=detail.retry_after_ms,
                    submit_ms=detail.submit_ms,
                    poll_ms=detail.poll_ms,
                    download_ms=detail.download_ms,
                    poll_count=detail.poll_count,
                    extra=_audit_extra(detail),
                )
            )
            session.commit()
    except Exception:
        logger.exception("Gateway detail ledger write failed request_id=%s", trace.request_id)
