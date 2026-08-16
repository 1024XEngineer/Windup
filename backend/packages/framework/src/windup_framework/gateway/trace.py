from __future__ import annotations

import hashlib
import json
import logging
from dataclasses import dataclass, fields
from enum import Enum

from windup_framework.gateway.types import Scene

logger = logging.getLogger("windup.gateway")


@dataclass
class AttemptTrace:
    request_id: str
    scene: Scene
    model: str
    attempt_id: str | None = None
    task_id: str | None = None
    user_id: str | None = None
    family: str | None = None
    base_url_host: str | None = None
    attempt_index: int | None = None
    retry_count: int = 0
    route_reason: str | None = None
    circuit_scope: str | None = None
    error_type: str | None = None
    http_status: int | None = None
    edge_fingerprint: str | None = None
    job_id: str | None = None
    fallback_used: bool = False
    outcome: str | None = None
    job_status: str | None = None
    started_at: str | None = None
    ended_at: str | None = None
    attempt_latency_ms: int | None = None
    total_latency_ms: int | None = None
    submit_ms: int | None = None
    poll_ms: int | None = None
    download_ms: int | None = None
    poll_count: int | None = None
    retry_after_ms: int | None = None
    resend_spent: int | None = None
    output_bytes: int | None = None
    expected_bytes: int | None = None
    input_hash: str | None = None
    output_hash: str | None = None
    maybe_billed: bool | None = None
    cost: float | None = None
    price_version: str | None = None
    provider_usage: object | None = None

    def as_dict(self) -> dict[str, object]:
        out: dict[str, object] = {}
        for f in fields(self):
            value = getattr(self, f.name)
            if isinstance(value, Enum):
                value = value.value
            out[f.name] = value
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


def emit(trace: AttemptTrace) -> None:
    logger.info("%s", json.dumps(trace.as_dict(), ensure_ascii=False, default=str))
