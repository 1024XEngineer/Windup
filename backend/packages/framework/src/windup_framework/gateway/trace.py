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
    error_message: str | None = None
    #: 这一跳**实际发给上游的提示词正文**(#841)。
    #:
    #: 存正文而不是只存 ``input_hash``:哈希能证明"两次发的一样",却答不了用户那句
    #: "这不是我要的动作"——而那正是它唯一会被查的场合。生产 #564 的诊断全部成本
    #: 都花在这里:任务结果里只有 ``prompt_version: v2``,要证明"我们发的和用户写的
    #: 不是一回事",只能读代码反推 + 去上游捞源视频(而源视频会过期)。
    #:
    #: 落 ``extra`` 而不是新开一列:这张表本来就是"我们往上游发了什么"的台账,
    #: 而 ``extra`` 已经在装同类的取证字段(policy_next_step / upstream_reached)。
    prompt: str | None = None
    finish_reason: str | None = None
    has_tool_calls: bool | None = None


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
    model: str | None = None,
) -> float | None:
    """``image_unit_cost`` 显式配置优先,否则按型号查美元牌价表。

    出图链上主备型号单价可以差一倍,再用单值记账会把成本算错,而错的方向随兜底是否
    触发而变 —— 不是一个固定偏差,事后无法回补。
    """
    if not billed:
        return None
    if scene == Scene.CHARACTER_IMAGE:
        if image_unit_cost is not None:
            return image_unit_cost
        from windup_framework.gateway.registry import IMAGE_UNIT_COST_USD

        return IMAGE_UNIT_COST_USD.get(model or "")
    if scene == Scene.CHARACTER_ACTION:
        from windup_framework.gateway.registry import (
            VIDEO_UNIT_COST_USD_PER_SECOND,
            billed_seconds,
        )

        # 配置的单值优先(网关转售价与官方牌价不一致时用它整体覆盖),否则按型号查牌价表。
        # 视频链跨型号之后每秒单价能差一倍以上,再用单值记账会把成本算错,而错的方向
        # 随兜底是否触发而变 —— 不是固定偏差,事后无法回补(与出图侧同一条理由)。
        rate = video_unit_cost_per_second
        if rate is None:
            rate = VIDEO_UNIT_COST_USD_PER_SECOND.get(model or "")
        if rate is None:
            return None
        return rate * billed_seconds(model, seconds)
    return None


def hash_image_input(prompt: str, refs: list[bytes]) -> str:
    payload = prompt.encode() + b"\0".join(refs)
    return hashlib.sha256(payload).hexdigest()


def hash_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def emit(trace: AttemptTrace) -> None:
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
    if provider_settings.gateway_ledger_enabled:
        from windup_framework.gateway.ledger import persist_attempt

        persist_attempt(trace)
