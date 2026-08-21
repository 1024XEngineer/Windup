from __future__ import annotations

import time
import uuid
from dataclasses import replace
from datetime import datetime, timezone

from windup_common.enums.model import ModelErrorType
from windup_framework.config.provider import AIProviderSettings, settings as default_settings
from windup_framework.gateway.billing import billing_flags, upstream_reached_label
from windup_framework.gateway.budget import AttemptBudget
from windup_framework.gateway.context import current_call_context
from windup_framework.gateway.image import _CIRCUIT
from windup_framework.gateway.policy import decide
from windup_framework.gateway.registry import ModelRegistry, RegistryError
from windup_framework.gateway.routes import (
    GatewayRoute,
    config_for_route,
    key_circuit_id,
    lookup_adapter,
    routes_from_settings,
)
from windup_framework.gateway.sequencer import AttemptSequencer
from windup_framework.gateway.trace import (
    AttemptDetail,
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
    def __init__(self, registry, adapter, circuit, settings, route_adapters=None) -> None:
        self._registry = registry
        self._adapter = adapter
        self._circuit = circuit
        self._settings = settings
        self._routes = routes_from_settings(settings, route_group=Scene.CHARACTER_ACTION.value)
        self._route_adapters = dict(route_adapters or {})

    def _adapter_for(self, route: GatewayRoute):
        return lookup_adapter(self._route_adapters, route, self._adapter)

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
        last_http_status: int | None = None
        last_error: ModelErrorType | None = None
        fallback_used = False
        fallback_reason: str | None = None
        route_reason_override: str | None = None
        routes = self._routes
        seq = AttemptSequencer()
        budget = AttemptBudget()

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
            route = routes[0]
            self._emit(
                AttemptTrace(
                    request_id=request_id,
                    scene=Scene.CHARACTER_ACTION,
                    model=model,
                    route=route,
                    attempt_index=seq.next_index(),
                    retry_count=0,
                    route_reason="skip_circuit_open",
                    outcome="failed",
                    circuit_scope="aggregator",
                    total_latency_ms=total_ms(),
                    maybe_billed=False,
                    detail=AttemptDetail(
                        input_hash=input_hash,
                        policy_next_step="fail",
                        upstream_reached="false",
                    ),
                )
            )
            fail(None)

        for route_index, route in enumerate(routes):
            if self._circuit.is_open("base_url:" + route.base_url_id):
                if route_index + 1 < len(routes):
                    fallback_used = True
                    route_reason_override = "base_url_unreached"
                    continue
                fail(last_http_status)
            if self._circuit.is_open(key_circuit_id(route)):
                if route_index + 1 < len(routes):
                    fallback_used = True
                    route_reason_override = "key_rate_limit"
                    continue
                fail(last_http_status)

            adapter = self._adapter_for(route)
            switch_to_next_route = False
            for i, model in enumerate(models):
                model_index = start_i + i
                if self._circuit.is_open("model:" + model):
                    fallback_used = True
                    fallback_reason = "skip"
                    self._emit(
                        AttemptTrace(
                            request_id=request_id,
                            scene=Scene.CHARACTER_ACTION,
                            model=model,
                            route=route,
                            attempt_index=seq.next_index(),
                            retry_count=0,
                            route_reason="skip_circuit_open",
                            outcome="failed",
                            circuit_scope="model",
                            fallback_used=fallback_used,
                            total_latency_ms=total_ms(),
                            maybe_billed=False,
                            detail=AttemptDetail(
                                input_hash=input_hash,
                                policy_next_step="fallback",
                                upstream_reached="false",
                                model_index=model_index,
                            ),
                        )
                    )
                    continue

                if i == 0:
                    route_reason = route_reason_override or (
                        "start_from_caller"
                        if ctx.start_from_model and ctx.start_from_model in chain
                        else "primary"
                    )
                elif fallback_reason == "429":
                    route_reason = "fallback_after_429"
                elif fallback_reason == "skip":
                    route_reason = "skip_circuit_open"
                else:
                    route_reason = "fallback_after_upstream_fail"

                retry_count = 0
                resend_spent = 0
                bound_job_id: str | None = None
                while True:
                    attempt_t0 = time.monotonic()
                    started_at = _utc_now()
                    submit_ms: int | None = None
                    if bound_job_id is None:
                        submit_t0 = time.monotonic()
                        result = adapter.submit_video(
                            first_frame, prompt, seconds, size, model
                        )
                        submit_ms = int((time.monotonic() - submit_t0) * 1000)
                        if result.ok and result.job_id:
                            bound_job_id = result.job_id
                            result = adapter.follow_job(bound_job_id)
                        elif result.ok:
                            result = replace(
                                result,
                                ok=False,
                                error_type=ModelErrorType.INVALID_RESPONSE,
                                body=b"",
                            )
                    else:
                        result = adapter.follow_job(bound_job_id)

                    ended_at = _utc_now()
                    attempt_latency_ms = int((time.monotonic() - attempt_t0) * 1000)
                    last_http_status = result.http_status
                    error_type = (
                        None if result.ok else (result.error_type or ModelErrorType.UNKNOWN)
                    )
                    maybe_billed = billing_flags(
                        error_type=error_type,
                        http_status=result.http_status,
                        ok=result.ok,
                    )
                    if not budget.can_record(maybe_billed):
                        self._emit_result(
                            request_id=request_id,
                            model=model,
                            route=route,
                            attempt_index=seq.next_index(),
                            retry_count=retry_count,
                            route_reason="attempt_budget_exhausted",
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
                            error_type=error_type,
                            submit_ms=submit_ms,
                            policy_next_step="fail",
                            model_index=model_index,
                            maybe_billed=maybe_billed,
                        )
                        fail(last_http_status)

                    if result.ok:
                        self._emit_result(
                            request_id=request_id,
                            model=model,
                            route=route,
                            attempt_index=seq.next_index(),
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
                            submit_ms=submit_ms,
                            policy_next_step="success",
                            model_index=model_index,
                            maybe_billed=maybe_billed,
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
                    has_next_route = route_index + 1 < len(routes)
                    if step is NextStep.FAIL and bound_job_id is None:
                        tier_step = budget.tier_b_escalation(
                            error_type,
                            has_next_route=has_next_route,
                            has_job_id=has_job_id,
                        )
                        if tier_step is not None:
                            step = tier_step
                            if tier_step is NextStep.OPEN_AGGREGATOR:
                                route_reason_override = "fallback_after_maybe_billed"
                    policy_next_step = step.value
                    circuit_scope = None
                    if step is NextStep.OPEN_AGGREGATOR:
                        if has_next_route:
                            self._circuit.open("base_url:" + route.base_url_id)
                            circuit_scope = "base_url"
                        else:
                            self._circuit.open("aggregator")
                            circuit_scope = "aggregator"
                    elif step is NextStep.FALLBACK_KEY:
                        self._circuit.open(key_circuit_id(route))
                        circuit_scope = "key"
                    elif step is NextStep.FALLBACK:
                        self._circuit.open("model:" + model)
                        circuit_scope = "model"

                    budget.record(maybe_billed)
                    self._emit_result(
                        request_id=request_id,
                        model=model,
                        route=route,
                        attempt_index=seq.next_index(),
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
                        submit_ms=submit_ms,
                        policy_next_step=policy_next_step,
                        model_index=model_index,
                        maybe_billed=maybe_billed,
                    )
                    if (
                        step is NextStep.OPEN_AGGREGATOR
                        and has_next_route
                        and bound_job_id is None
                    ):
                        fallback_used = True
                        route_reason_override = "base_url_unreached"
                        switch_to_next_route = True
                        break
                    if step is NextStep.FALLBACK_KEY:
                        if bound_job_id is not None:
                            fail(last_http_status)
                        if has_next_route:
                            fallback_used = True
                            route_reason_override = "key_rate_limit"
                            switch_to_next_route = True
                            break
                        fail(last_http_status)
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
                        if (
                            bound_job_id is not None
                            and error_type is not ModelErrorType.UPSTREAM_FAILED
                        ):
                            fail(last_http_status)
                        if (
                            bound_job_id is None
                            and error_type is not ModelErrorType.RATE_LIMIT
                        ):
                            fail(last_http_status)
                        fallback_used = True
                        fallback_reason = (
                            "429" if error_type is ModelErrorType.RATE_LIMIT else "upstream"
                        )
                        bound_job_id = None
                        break
                    fail(last_http_status)
                if switch_to_next_route:
                    break
            if switch_to_next_route:
                continue
            route_reason_override = None

        fail(last_http_status)

    def _emit_result(
        self,
        *,
        request_id: str,
        model: str,
        route: GatewayRoute,
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
        submit_ms: int | None = None,
        policy_next_step: str | None = None,
        model_index: int | None = None,
        maybe_billed: bool | None = None,
    ) -> None:
        if maybe_billed is None:
            maybe_billed = billing_flags(
                error_type=error_type,
                http_status=result.http_status,
                ok=result.ok,
            )
        cost = estimate_cost(
            Scene.CHARACTER_ACTION,
            billed=result.ok or maybe_billed,
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
            AttemptTrace(
                request_id=request_id,
                scene=Scene.CHARACTER_ACTION,
                model=model,
                route=route,
                attempt_index=attempt_index,
                retry_count=retry_count,
                route_reason=route_reason,
                outcome=outcome,
                circuit_scope=circuit_scope,
                error_type=error_type.value if error_type is not None else None,
                http_status=result.http_status,
                job_id=result.job_id,
                fallback_used=fallback_used,
                started_at=started_at,
                ended_at=ended_at,
                attempt_latency_ms=attempt_latency_ms,
                total_latency_ms=total_latency_ms,
                maybe_billed=maybe_billed,
                cost=cost,
                detail=AttemptDetail(
                    input_hash=input_hash,
                    output_hash=hash_bytes(result.body) if result.ok else None,
                    output_bytes=len(result.body) if result.ok else (result.output_bytes or None),
                    expected_bytes=result.expected_bytes,
                    retry_after_ms=retry_after_ms,
                    submit_ms=submit_ms,
                    poll_ms=result.poll_ms,
                    download_ms=result.download_ms,
                    poll_count=result.poll_count,
                    resend_spent=resend_spent,
                    job_status=result.job_status,
                    edge_fingerprint=result.edge_fingerprint or None,
                    provider_usage=result.provider_usage,
                    policy_next_step=policy_next_step,
                    upstream_reached=upstream_reached_label(
                        error_type, http_status=result.http_status, ok=result.ok
                    ),
                    model_index=model_index,
                ),
            )
        )

    def _emit(self, trace: AttemptTrace) -> None:
        if not trace.family and trace.model:
            try:
                trace.family = self._registry.family_of(trace.model).value
            except RegistryError:
                pass
        if not trace.started_at:
            trace.started_at = _utc_now()
        if not trace.ended_at:
            trace.ended_at = _utc_now()
        if trace.price_version is None:
            trace.price_version = self._settings.price_version
        emit(trace)


def build_video_gateway(config=None, *, adapter=None, circuit=None) -> VideoGateway:
    cfg: AIProviderSettings = config or default_settings
    route_adapters = None
    if adapter is None:
        from windup_framework.providers.sufy import SufyVideoProvider

        routes = routes_from_settings(cfg, route_group=Scene.CHARACTER_ACTION.value)
        route_adapters = {
            route.route_id: SufyVideoProvider(config=config_for_route(cfg, route))
            for route in routes
        }
        adapter = route_adapters[routes[0].route_id]
    return VideoGateway(
        ModelRegistry.from_settings(cfg),
        adapter,
        circuit if circuit is not None else _CIRCUIT,
        cfg,
        route_adapters=route_adapters,
    )
