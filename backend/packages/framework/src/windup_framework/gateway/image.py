from __future__ import annotations

import time
import uuid
from datetime import datetime, timezone

from windup_common.enums.model import ModelErrorType
from windup_framework.config.provider import AIProviderSettings, settings as default_settings
from windup_framework.gateway.circuit import CircuitBreaker
from windup_framework.gateway.context import current_call_context
from windup_framework.gateway.policy import decide
from windup_framework.gateway.registry import ModelRegistry
from windup_framework.gateway.routes import (
    GatewayRoute,
    config_for_route,
    route_layer_for,
    routes_from_settings,
)
from windup_framework.gateway.trace import (
    AttemptTrace,
    emit,
    estimate_cost,
    hash_bytes,
    hash_image_input,
)
from windup_framework.gateway.types import NextStep, Scene

_CIRCUIT = CircuitBreaker()
_DEFAULT_RETRY_AFTER_S = 2.0
_SLEEP_CAP_S = 30.0


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


class ImageGateway:
    def __init__(self, registry, adapter, circuit, settings, route_adapters=None) -> None:
        self._registry = registry
        self._adapter = adapter
        self._circuit = circuit
        self._settings = settings
        self._routes = routes_from_settings(settings, route_group=Scene.CHARACTER_IMAGE.value)
        self._route_adapters = dict(route_adapters or {})

    def _adapter_for(self, route: GatewayRoute):
        return self._route_adapters.get(route.base_url_id, self._adapter)

    def gen_image(self, prompt: str, refs: list[bytes]) -> bytes:
        ctx = current_call_context()
        request_id = ctx.request_id or str(uuid.uuid4())
        started = time.monotonic()
        input_hash = hash_image_input(prompt, refs)
        last_http_status: int | None = None
        fallback_used = False
        fallback_reason: str | None = None
        route_reason_override: str | None = None
        routes = self._routes

        chain = list(self._registry.chain(Scene.CHARACTER_IMAGE))
        if ctx.start_from_model and ctx.start_from_model in chain:
            start_i = chain.index(ctx.start_from_model)
            models = chain[start_i:]
        else:
            start_i = 0
            models = chain

        def total_ms() -> int:
            return int((time.monotonic() - started) * 1000)

        def fail(http_status: int | None) -> None:
            raise RuntimeError(
                f"image gateway failed request_id={request_id} http_status={http_status}"
            )

        if self._circuit.is_open("aggregator"):
            model = models[0] if models else ""
            route = routes[0]
            self._emit(
                request_id=request_id,
                ctx=ctx,
                model=model,
                route=route,
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

        for route_index, route in enumerate(routes):
            if self._circuit.is_open("base_url:" + route.base_url_id):
                if route_index + 1 < len(routes):
                    fallback_used = True
                    route_reason_override = "base_url_unreached"
                    continue
                fail(last_http_status)

            adapter = self._adapter_for(route)
            switch_to_next_route = False
            for i, model in enumerate(models):
                attempt_index = start_i + i
                if self._circuit.is_open("model:" + model):
                    fallback_used = True
                    fallback_reason = "skip"
                    self._emit(
                        request_id=request_id,
                        ctx=ctx,
                        model=model,
                        route=route,
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
                while True:
                    attempt_t0 = time.monotonic()
                    started_at = _utc_now()
                    result = adapter.submit_image(prompt, refs, model)
                    ended_at = _utc_now()
                    attempt_latency_ms = int((time.monotonic() - attempt_t0) * 1000)
                    last_http_status = result.http_status
                    billed = result.ok or result.maybe_billed
                    cost = estimate_cost(
                        Scene.CHARACTER_IMAGE,
                        billed=billed,
                        seconds=0,
                        image_unit_cost=self._settings.image_unit_cost,
                        video_unit_cost_per_second=self._settings.video_unit_cost_per_second,
                    )
                    retry_after_ms = (
                        int(result.retry_after_s * 1000)
                        if result.retry_after_s is not None
                        else None
                    )
                    if result.ok:
                        self._emit(
                            request_id=request_id,
                            ctx=ctx,
                            model=model,
                            route=route,
                            attempt_index=attempt_index,
                            retry_count=retry_count,
                            route_reason=route_reason,
                            circuit_scope=None,
                            outcome="fallback_success" if fallback_used else "success",
                            input_hash=input_hash,
                            output_hash=hash_bytes(result.body),
                            total_latency_ms=total_ms(),
                            fallback_used=fallback_used,
                            http_status=result.http_status,
                            maybe_billed=True,
                            cost=cost,
                            started_at=started_at,
                            ended_at=ended_at,
                            attempt_latency_ms=attempt_latency_ms,
                            resend_spent=resend_spent,
                            output_bytes=len(result.body),
                            expected_bytes=result.expected_bytes,
                            provider_usage=result.provider_usage,
                            edge_fingerprint=result.edge_fingerprint or None,
                            job_id=result.job_id,
                            job_status=result.job_status,
                            retry_after_ms=retry_after_ms,
                        )
                        return result.body

                    error_type = result.error_type or ModelErrorType.UNKNOWN
                    step = decide(
                        error_type=error_type,
                        retry_count=retry_count,
                        has_job_id=bool(result.job_id),
                    )
                    circuit_scope = None
                    has_next_route = route_index + 1 < len(routes)
                    if step is NextStep.OPEN_AGGREGATOR:
                        if has_next_route:
                            self._circuit.open("base_url:" + route.base_url_id)
                            circuit_scope = "base_url"
                        else:
                            self._circuit.open("aggregator")
                            circuit_scope = "aggregator"
                    elif step is NextStep.FALLBACK:
                        self._circuit.open("model:" + model)
                        circuit_scope = "model"

                    self._emit(
                        request_id=request_id,
                        ctx=ctx,
                        model=model,
                        route=route,
                        attempt_index=attempt_index,
                        retry_count=retry_count,
                        route_reason=route_reason,
                        circuit_scope=circuit_scope,
                        outcome="failed",
                        input_hash=input_hash,
                        output_hash=None,
                        total_latency_ms=total_ms(),
                        fallback_used=fallback_used,
                        http_status=result.http_status,
                        error_type=error_type.value,
                        maybe_billed=result.maybe_billed,
                        cost=cost,
                        started_at=started_at,
                        ended_at=ended_at,
                        attempt_latency_ms=attempt_latency_ms,
                        resend_spent=resend_spent,
                        output_bytes=result.output_bytes or None,
                        expected_bytes=result.expected_bytes,
                        provider_usage=result.provider_usage,
                        edge_fingerprint=result.edge_fingerprint or None,
                        job_id=result.job_id,
                        job_status=result.job_status,
                        retry_after_ms=retry_after_ms,
                    )
                    if step is NextStep.OPEN_AGGREGATOR and has_next_route:
                        fallback_used = True
                        route_reason_override = "base_url_unreached"
                        switch_to_next_route = True
                        break
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
                        break
                    fail(last_http_status)
                if switch_to_next_route:
                    break
            if switch_to_next_route:
                continue
            route_reason_override = None

        fail(last_http_status)

    def _emit(
        self,
        *,
        request_id: str,
        ctx,
        model: str,
        route: GatewayRoute,
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
                scene=Scene.CHARACTER_IMAGE,
                model=model,
                family=family,
                route_id=route.route_id,
                route_group=route.route_group,
                candidate_index=route.candidate_index,
                provider_name=route.provider_name,
                base_url_id=route.base_url_id,
                base_url_host=route.host,
                api_key_id=route.api_key_id,
                attempt_index=attempt_index,
                retry_count=retry_count,
                route_reason=route_reason,
                route_layer=route_layer_for(route_reason),
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


def build_image_gateway(config=None, *, adapter=None, circuit=None) -> ImageGateway:
    cfg: AIProviderSettings = config or default_settings
    route_adapters = None
    if adapter is None:
        from windup_framework.providers.sufy import SufyImageProvider

        routes = routes_from_settings(cfg, route_group=Scene.CHARACTER_IMAGE.value)
        route_adapters = {
            route.base_url_id: SufyImageProvider(config=config_for_route(cfg, route))
            for route in routes
        }
        adapter = route_adapters[routes[0].base_url_id]
    return ImageGateway(
        ModelRegistry.from_settings(cfg),
        adapter,
        circuit if circuit is not None else _CIRCUIT,
        cfg,
        route_adapters=route_adapters,
    )
