from __future__ import annotations

import time
import uuid
from datetime import datetime, timezone
from urllib.parse import urlparse

from windup_common.enums.model import ModelErrorType
from windup_framework.config.provider import AIProviderSettings, settings as default_settings
from windup_framework.gateway.context import current_call_context
from windup_framework.gateway.image import _CIRCUIT
from windup_framework.gateway.policy import decide
from windup_framework.gateway.registry import ModelRegistry
from windup_framework.gateway.trace import (
    AttemptTrace,
    emit,
    estimate_cost,
    hash_bytes,
    hash_image_input,
)
from windup_framework.gateway.types import NextStep, Scene

_DEFAULT_RETRY_AFTER_S = 2.0
_SLEEP_CAP_S = 30.0


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


class VideoGateway:
    def __init__(self, registry, adapter, circuit, settings) -> None:
        self._registry = registry
        self._adapter = adapter
        self._circuit = circuit
        self._settings = settings

    def i2v(
        self,
        first_frame: bytes,
        prompt: str,
        seconds: int = 5,
        size: str = "1280x720",
    ) -> bytes:
        ctx = current_call_context()
        request_id = ctx.request_id or str(uuid.uuid4())
        started = time.monotonic()
        input_hash = hash_image_input(prompt, [first_frame])
        host = urlparse(self._settings.base_url).hostname
        last_http_status: int | None = None
        last_error: ModelErrorType | None = None
        fallback_used = False
        fallback_reason: str | None = None

        chain = list(self._registry.chain(Scene.CHARACTER_ACTION))
        if ctx.start_from_model and ctx.start_from_model in chain:
            start_i = chain.index(ctx.start_from_model)
            models = chain[start_i:]
        else:
            start_i = 0
            models = chain

        def total_ms() -> int:
            return int((time.monotonic() - started) * 1000)

        def fail(http_status: int | None) -> None:
            err = last_error.value if last_error is not None else None
            raise RuntimeError(
                f"video gateway failed request_id={request_id} "
                f"http_status={http_status} error_type={err}"
            )

        if self._circuit.is_open("aggregator"):
            model = models[0] if models else ""
            self._emit(
                request_id=request_id,
                ctx=ctx,
                model=model,
                host=host,
                attempt_index=start_i,
                retry_count=0,
                route_reason="skip_circuit_open",
                circuit_scope="aggregator",
                outcome="failed",
                input_hash=input_hash,
                total_latency_ms=total_ms(),
                fallback_used=False,
            )
            fail(None)

        for i, model in enumerate(models):
            attempt_index = start_i + i
            if self._circuit.is_open("model:" + model):
                self._emit(
                    request_id=request_id,
                    ctx=ctx,
                    model=model,
                    host=host,
                    attempt_index=attempt_index,
                    retry_count=0,
                    route_reason="skip_circuit_open",
                    circuit_scope="model",
                    outcome="failed",
                    input_hash=input_hash,
                    total_latency_ms=total_ms(),
                    fallback_used=fallback_used,
                )
                continue

            if i == 0:
                route_reason = (
                    "start_from_caller"
                    if ctx.start_from_model and ctx.start_from_model in chain
                    else "primary"
                )
            elif fallback_reason == "429":
                route_reason = "fallback_after_429"
            else:
                route_reason = "fallback_after_upstream_fail"

            retry_count = 0
            resend_spent = 0
            bound_job_id: str | None = None
            while True:
                attempt_t0 = time.monotonic()
                started_at = _utc_now()
                if bound_job_id is None:
                    result = self._adapter.submit_video(
                        first_frame, prompt, seconds, size, model
                    )
                    if result.ok and result.job_id:
                        bound_job_id = result.job_id
                        result = self._adapter.follow_job(bound_job_id)
                    elif result.ok:
                        ended_at = _utc_now()
                        attempt_latency_ms = int((time.monotonic() - attempt_t0) * 1000)
                        last_http_status = result.http_status
                        self._emit_result(
                            request_id=request_id,
                            ctx=ctx,
                            model=model,
                            host=host,
                            attempt_index=attempt_index,
                            retry_count=retry_count,
                            route_reason=route_reason,
                            result=result,
                            input_hash=input_hash,
                            total_latency_ms=total_ms(),
                            fallback_used=fallback_used,
                            started_at=started_at,
                            ended_at=ended_at,
                            attempt_latency_ms=attempt_latency_ms,
                            resend_spent=resend_spent,
                            seconds=seconds,
                            outcome="fallback_success" if fallback_used else "success",
                        )
                        return result.body
                else:
                    result = self._adapter.follow_job(bound_job_id)

                ended_at = _utc_now()
                attempt_latency_ms = int((time.monotonic() - attempt_t0) * 1000)
                last_http_status = result.http_status
                if result.ok:
                    self._emit_result(
                        request_id=request_id,
                        ctx=ctx,
                        model=model,
                        host=host,
                        attempt_index=attempt_index,
                        retry_count=retry_count,
                        route_reason=route_reason,
                        result=result,
                        input_hash=input_hash,
                        total_latency_ms=total_ms(),
                        fallback_used=fallback_used,
                        started_at=started_at,
                        ended_at=ended_at,
                        attempt_latency_ms=attempt_latency_ms,
                        resend_spent=resend_spent,
                        seconds=seconds,
                        outcome="fallback_success" if fallback_used else "success",
                    )
                    return result.body

                error_type = result.error_type or ModelErrorType.UNKNOWN
                last_error = error_type
                has_job_id = bool(result.job_id or bound_job_id)
                step = decide(
                    error_type=error_type,
                    retry_count=retry_count,
                    has_job_id=has_job_id,
                )
                circuit_scope = None
                if step is NextStep.OPEN_AGGREGATOR:
                    self._circuit.open("aggregator")
                    circuit_scope = "aggregator"
                elif step is NextStep.FALLBACK:
                    self._circuit.open("model:" + model)
                    circuit_scope = "model"

                self._emit_result(
                    request_id=request_id,
                    ctx=ctx,
                    model=model,
                    host=host,
                    attempt_index=attempt_index,
                    retry_count=retry_count,
                    route_reason=route_reason,
                    result=result,
                    input_hash=input_hash,
                    total_latency_ms=total_ms(),
                    fallback_used=fallback_used,
                    started_at=started_at,
                    ended_at=ended_at,
                    attempt_latency_ms=attempt_latency_ms,
                    resend_spent=resend_spent,
                    seconds=seconds,
                    outcome="failed",
                    circuit_scope=circuit_scope,
                    error_type=error_type,
                )
                if step is NextStep.RETRY_SAME:
                    if error_type is ModelErrorType.RATE_LIMIT:
                        wait = (
                            result.retry_after_s
                            if result.retry_after_s is not None
                            else _DEFAULT_RETRY_AFTER_S
                        )
                        time.sleep(min(wait, _SLEEP_CAP_S))
                    retry_count += 1
                    if error_type is ModelErrorType.UNREACHED:
                        resend_spent = 1
                    continue
                if step is NextStep.FALLBACK:
                    fallback_used = True
                    fallback_reason = (
                        "429" if error_type is ModelErrorType.RATE_LIMIT else "upstream"
                    )
                    bound_job_id = None
                    break
                fail(last_http_status)

        fail(last_http_status)

    def _emit_result(
        self,
        *,
        request_id: str,
        ctx,
        model: str,
        host: str | None,
        attempt_index: int,
        retry_count: int,
        route_reason: str,
        result,
        input_hash: str,
        total_latency_ms: int,
        fallback_used: bool,
        started_at: str,
        ended_at: str,
        attempt_latency_ms: int,
        resend_spent: int,
        seconds: int,
        outcome: str,
        circuit_scope: str | None = None,
        error_type: ModelErrorType | None = None,
    ) -> None:
        billed = result.ok or result.maybe_billed
        cost = estimate_cost(
            Scene.CHARACTER_ACTION,
            billed=billed,
            seconds=seconds,
            image_unit_cost=self._settings.image_unit_cost,
            video_unit_cost_per_second=self._settings.video_unit_cost_per_second,
        )
        retry_after_ms = (
            int(result.retry_after_s * 1000)
            if result.retry_after_s is not None
            else None
        )
        self._emit(
            request_id=request_id,
            ctx=ctx,
            model=model,
            host=host,
            attempt_index=attempt_index,
            retry_count=retry_count,
            route_reason=route_reason,
            circuit_scope=circuit_scope,
            outcome=outcome,
            input_hash=input_hash,
            output_hash=hash_bytes(result.body) if result.ok else None,
            total_latency_ms=total_latency_ms,
            fallback_used=fallback_used,
            http_status=result.http_status,
            error_type=error_type.value if error_type is not None else None,
            maybe_billed=True if result.ok else result.maybe_billed,
            cost=cost,
            started_at=started_at,
            ended_at=ended_at,
            attempt_latency_ms=attempt_latency_ms,
            resend_spent=resend_spent,
            output_bytes=len(result.body) if result.ok else (result.output_bytes or None),
            expected_bytes=result.expected_bytes,
            provider_usage=result.provider_usage,
            edge_fingerprint=result.edge_fingerprint or None,
            job_id=result.job_id,
            job_status=result.job_status,
            retry_after_ms=retry_after_ms,
        )

    def _emit(
        self,
        *,
        request_id: str,
        ctx,
        model: str,
        host: str | None,
        attempt_index: int,
        retry_count: int,
        route_reason: str,
        circuit_scope: str | None,
        outcome: str,
        input_hash: str,
        total_latency_ms: int,
        fallback_used: bool,
        output_hash: str | None = None,
        http_status: int | None = None,
        error_type: str | None = None,
        maybe_billed: bool | None = None,
        cost: float | None = None,
        started_at: str | None = None,
        ended_at: str | None = None,
        attempt_latency_ms: int | None = None,
        resend_spent: int | None = 0,
        output_bytes: int | None = None,
        expected_bytes: int | None = None,
        provider_usage: object | None = None,
        edge_fingerprint: str | None = None,
        job_id: str | None = None,
        job_status: str | None = None,
        retry_after_ms: int | None = None,
    ) -> None:
        family = None
        if model:
            family = self._registry.family_of(model).value
        emit(
            AttemptTrace(
                request_id=request_id,
                attempt_id=str(uuid.uuid4()),
                task_id=ctx.task_id,
                user_id=ctx.user_id,
                scene=Scene.CHARACTER_ACTION,
                model=model,
                family=family,
                base_url_host=host,
                attempt_index=attempt_index,
                retry_count=retry_count,
                route_reason=route_reason,
                circuit_scope=circuit_scope,
                error_type=error_type,
                http_status=http_status,
                edge_fingerprint=edge_fingerprint,
                job_id=job_id,
                fallback_used=fallback_used,
                outcome=outcome,
                job_status=job_status,
                started_at=started_at or _utc_now(),
                ended_at=ended_at or _utc_now(),
                attempt_latency_ms=attempt_latency_ms,
                total_latency_ms=total_latency_ms,
                submit_ms=None,
                poll_ms=None,
                download_ms=None,
                poll_count=None,
                retry_after_ms=retry_after_ms,
                resend_spent=resend_spent,
                output_bytes=output_bytes,
                expected_bytes=expected_bytes,
                input_hash=input_hash,
                output_hash=output_hash,
                maybe_billed=maybe_billed,
                cost=cost,
                price_version=self._settings.price_version,
                provider_usage=provider_usage,
            )
        )


def build_video_gateway(config=None, *, adapter=None, circuit=None) -> VideoGateway:
    cfg: AIProviderSettings = config or default_settings
    if adapter is None:
        from windup_framework.providers.sufy import SufyVideoProvider

        adapter = SufyVideoProvider(config=cfg)
    return VideoGateway(
        ModelRegistry.from_settings(cfg),
        adapter,
        circuit if circuit is not None else _CIRCUIT,
        cfg,
    )
