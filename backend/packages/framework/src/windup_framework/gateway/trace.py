from __future__ import annotations

import hashlib
import json
import logging
import uuid
from dataclasses import dataclass, fields
from enum import Enum

from windup_framework.config.provider import settings as provider_settings
from windup_framework.gateway.context import current_call_context
from windup_framework.gateway.routes import GatewayRoute, route_layer_for
from windup_framework.gateway.types import Scene

logger = logging.getLogger("windup.gateway")


@dataclass
class AttemptDetail:
    input_hash: str | None = None
    output_hash: str | None = None
    output_bytes: int | None = None
    expected_bytes: int | None = None
    retry_after_ms: int | None = None
    submit_ms: int | None = None
    poll_ms: int | None = None
    download_ms: int | None = None
    poll_count: int | None = None
    resend_spent: int | None = None
    job_status: str | None = None
    edge_fingerprint: str | None = None
    provider_usage: object | None = None
    policy_next_step: str | None = None
    upstream_reached: str | None = None
    model_index: int | None = None


@dataclass
class AttemptTrace:
    request_id: str
    scene: Scene
    model: str
    route: GatewayRoute
    attempt_index: int
    retry_count: int
    route_reason: str
    outcome: str
    attempt_id: str | None = None
    task_id: str | None = None
    user_id: str | None = None
    family: str | None = None
    circuit_scope: str | None = None
    error_type: str | None = None
    http_status: int | None = None
    job_id: str | None = None
    fallback_used: bool = False
    started_at: str | None = None
    ended_at: str | None = None
    attempt_latency_ms: int | None = None
    total_latency_ms: int | None = None
    maybe_billed: bool | None = None
    cost: float | None = None
    price_version: str | None = None
    detail: AttemptDetail | None = None

    def as_dict(self) -> dict[str, object]:
        out: dict[str, object] = {}
        for f in fields(self):
            if f.name in {"route", "detail"}:
                continue
            value = getattr(self, f.name)
            if isinstance(value, Enum):
                value = value.value
            out[f.name] = value
        out["route_id"] = self.route.route_id
        out["route_group"] = self.route.route_group
        out["candidate_index"] = self.route.candidate_index
        out["provider_name"] = self.route.provider_name
        out["base_url_id"] = self.route.base_url_id
        out["base_url_host"] = self.route.host
        out["api_key_id"] = self.route.api_key_id
        out["route_layer"] = route_layer_for(self.route_reason)
        detail = self.detail or AttemptDetail()
        for f in fields(detail):
            out[f.name] = getattr(detail, f.name)
        return out


def estimate_cost(
    scene: Scene,
    *,
    billed: bool,
    seconds: int,
    image_unit_cost: float | None = None,
    video_unit_cost_per_second: float | None = None,
) -> float | None:
    if not billed:
        return None
    if scene == Scene.CHARACTER_IMAGE:
        return image_unit_cost
    if scene == Scene.CHARACTER_ACTION:
        if video_unit_cost_per_second is None:
            return None
        return video_unit_cost_per_second * seconds
    return None


def hash_image_input(prompt: str, refs: list[bytes]) -> str:
    payload = prompt.encode() + b"\0".join(refs)
    return hashlib.sha256(payload).hexdigest()


def hash_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def emit(trace: AttemptTrace, *, ledger_enabled: bool | None = None) -> None:
    ctx = current_call_context()
    if not trace.attempt_id:
        trace.attempt_id = str(uuid.uuid4())
    if trace.task_id is None:
        trace.task_id = ctx.task_id
    if trace.user_id is None:
        trace.user_id = ctx.user_id
    if trace.price_version is None:
        trace.price_version = provider_settings.price_version
    logger.info("%s", json.dumps(trace.as_dict(), ensure_ascii=False, default=str))
    if ledger_enabled is None:
        ledger_enabled = provider_settings.gateway_ledger_enabled
    if ledger_enabled:
        from windup_framework.gateway.ledger import persist_attempt

        persist_attempt(trace)
