from __future__ import annotations

import hashlib
import json
import time
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

import httpx
from langchain_openai import ChatOpenAI

from windup_common.enums.model import ModelErrorType
from windup_framework.config.provider import AIProviderSettings, settings as default_settings
from windup_framework.gateway.circuit import CircuitBreaker
from windup_framework.gateway.context import current_call_context
from windup_framework.gateway.policy import decide
from windup_framework.gateway.routes import (
    GatewayRoute,
    config_for_route,
    key_circuit_id,
    lookup_adapter,
    routes_from_settings,
)
from windup_framework.gateway.trace import AttemptDetail, AttemptTrace, emit
from windup_framework.gateway.types import Family, NextStep, Scene

_CIRCUIT = CircuitBreaker()
_DEFAULT_RETRY_AFTER_S = 2.0
_SLEEP_CAP_S = 30.0


@dataclass(frozen=True)
class ChatAdapterResult:
    ok: bool
    value: Any = None
    error_type: ModelErrorType | None = None
    http_status: int | None = None
    edge_fingerprint: str = ""
    retry_after_s: float | None = None
    provider_usage: object | None = None


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _parse_fallbacks(raw: str) -> tuple[str, ...]:
    return tuple(part.strip() for part in raw.split(",") if part.strip())


def _hash_messages(messages: Any) -> str:
    payload = json.dumps(messages, ensure_ascii=False, default=str, sort_keys=True)
    return hashlib.sha256(payload.encode()).hexdigest()


def _error_type_from_exception(exc: Exception) -> tuple[ModelErrorType, int | None, str]:
    status = getattr(exc, "status_code", None)
    response = getattr(exc, "response", None)
    if status is None and response is not None:
        status = getattr(response, "status_code", None)
    if isinstance(status, int):
        from windup_framework.gateway.classify import classify_http

        return classify_http(status), status, str(exc)[:200]
    if isinstance(exc, (httpx.ConnectError, httpx.NetworkError)):
        return ModelErrorType.UNREACHED, None, str(exc)[:200]
    if isinstance(exc, (httpx.ReadTimeout, httpx.TimeoutException, TimeoutError)):
        return ModelErrorType.TIMEOUT, None, str(exc)[:200]
    return ModelErrorType.UNKNOWN, None, str(exc)[:200]


class LangChainChatAdapter:
    """Protocol adapter: Gateway policy around LangChain's ChatOpenAI client."""

    def __init__(self, config: AIProviderSettings, **client_kwargs: Any) -> None:
        self._cfg = config
        self._client_kwargs = client_kwargs

    def invoke(self, messages: Any, *, model: str, **kwargs: Any) -> ChatAdapterResult:
        client = ChatOpenAI(
            model=model,
            api_key=self._cfg.api_key or None,
            base_url=self._cfg.normalized_base_url,
            timeout=self._cfg.timeout,
            # Gateway owns retry/circuit accounting; hidden SDK retries blur attempts.
            max_retries=0,
            **self._client_kwargs,
        )
        try:
            return ChatAdapterResult(ok=True, value=client.invoke(messages, **kwargs))
        except Exception as exc:
            error_type, status, edge = _error_type_from_exception(exc)
            return ChatAdapterResult(
                ok=False,
                error_type=error_type,
                http_status=status,
                edge_fingerprint=edge,
            )


class ChatGateway:
    def __init__(self, adapter, circuit, settings, route_adapters=None) -> None:
        self._adapter = adapter
        self._circuit = circuit
        self._settings = settings
        self._routes = routes_from_settings(settings, route_group=Scene.CHAT.value)
        self._route_adapters = dict(route_adapters or {})

    def _adapter_for(self, route: GatewayRoute):
        return lookup_adapter(self._route_adapters, route, self._adapter)

    def _models(self) -> tuple[str, ...]:
        if not self._settings.model.strip():
            raise RuntimeError("chat gateway requires AI_MODEL")
        return (self._settings.model, *_parse_fallbacks(self._settings.chat_fallbacks))

    def invoke(self, messages: Any, **kwargs: Any) -> Any:
        ctx = current_call_context()
        request_id = ctx.request_id or str(uuid.uuid4())
        started = time.monotonic()
        input_hash = _hash_messages(messages)
        models = self._models()
        fallback_used = False
        fallback_reason: str | None = None
        route_reason_override: str | None = None
        last_http_status: int | None = None

        def total_ms() -> int:
            return int((time.monotonic() - started) * 1000)

        def fail(http_status: int | None) -> None:
            raise RuntimeError(
                f"chat gateway failed request_id={request_id} http_status={http_status}"
            )

        if self._circuit.is_open("aggregator"):
            self._emit(
                AttemptTrace(
                    request_id=request_id,
                    scene=Scene.CHAT,
                    model=models[0],
                    family=Family.CHAT_COMPLETIONS.value,
                    route=self._routes[0],
                    attempt_index=0,
                    retry_count=0,
                    route_reason="skip_circuit_open",
                    outcome="failed",
                    circuit_scope="aggregator",
                    total_latency_ms=total_ms(),
                    detail=AttemptDetail(input_hash=input_hash),
                )
            )
            fail(None)

        for route_index, route in enumerate(self._routes):
            if self._circuit.is_open("base_url:" + route.base_url_id):
                if route_index + 1 < len(self._routes):
                    fallback_used = True
                    route_reason_override = "base_url_unreached"
                    continue
                fail(last_http_status)
            if self._circuit.is_open(key_circuit_id(route)):
                if route_index + 1 < len(self._routes):
                    fallback_used = True
                    route_reason_override = "key_rate_limit"
                    continue
                fail(last_http_status)

            adapter = self._adapter_for(route)
            switch_to_next_route = False
            for model_index, model in enumerate(models):
                if model_index == 0:
                    route_reason = route_reason_override or "primary"
                elif fallback_reason == "429":
                    route_reason = "fallback_after_429"
                else:
                    route_reason = "fallback_after_upstream_fail"

                retry_count = 0
                while True:
                    attempt_t0 = time.monotonic()
                    started_at = _utc_now()
                    result = adapter.invoke(messages, model=model, **kwargs)
                    ended_at = _utc_now()
                    attempt_latency_ms = int((time.monotonic() - attempt_t0) * 1000)
                    last_http_status = result.http_status
                    retry_after_ms = (
                        int(result.retry_after_s * 1000)
                        if result.retry_after_s is not None
                        else None
                    )
                    if result.ok:
                        self._emit(
                            AttemptTrace(
                                request_id=request_id,
                                scene=Scene.CHAT,
                                model=model,
                                family=Family.CHAT_COMPLETIONS.value,
                                route=route,
                                attempt_index=model_index,
                                retry_count=retry_count,
                                route_reason=route_reason,
                                outcome="fallback_success" if fallback_used else "success",
                                http_status=result.http_status,
                                fallback_used=fallback_used,
                                started_at=started_at,
                                ended_at=ended_at,
                                attempt_latency_ms=attempt_latency_ms,
                                total_latency_ms=total_ms(),
                                maybe_billed=True,
                                detail=AttemptDetail(
                                    input_hash=input_hash,
                                    output_bytes=len(str(result.value).encode()),
                                    retry_after_ms=retry_after_ms,
                                    edge_fingerprint=result.edge_fingerprint or None,
                                    provider_usage=result.provider_usage,
                                ),
                            )
                        )
                        return result.value

                    error_type = result.error_type or ModelErrorType.UNKNOWN
                    step = decide(
                        error_type=error_type,
                        retry_count=retry_count,
                        has_job_id=False,
                    )
                    has_next_route = route_index + 1 < len(self._routes)
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

                    self._emit(
                        AttemptTrace(
                            request_id=request_id,
                            scene=Scene.CHAT,
                            model=model,
                            family=Family.CHAT_COMPLETIONS.value,
                            route=route,
                            attempt_index=model_index,
                            retry_count=retry_count,
                            route_reason=route_reason,
                            outcome="failed",
                            circuit_scope=circuit_scope,
                            error_type=error_type.value,
                            http_status=result.http_status,
                            fallback_used=fallback_used,
                            started_at=started_at,
                            ended_at=ended_at,
                            attempt_latency_ms=attempt_latency_ms,
                            total_latency_ms=total_ms(),
                            maybe_billed=False,
                            detail=AttemptDetail(
                                input_hash=input_hash,
                                retry_after_ms=retry_after_ms,
                                edge_fingerprint=result.edge_fingerprint or None,
                                provider_usage=result.provider_usage,
                            ),
                        )
                    )
                    if step is NextStep.OPEN_AGGREGATOR and has_next_route:
                        fallback_used = True
                        route_reason_override = "base_url_unreached"
                        switch_to_next_route = True
                        break
                    if step is NextStep.FALLBACK_KEY:
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

    def _emit(self, trace: AttemptTrace) -> None:
        if not trace.started_at:
            trace.started_at = _utc_now()
        if not trace.ended_at:
            trace.ended_at = _utc_now()
        if trace.price_version is None:
            trace.price_version = self._settings.price_version
        emit(trace)


def build_chat_gateway(config=None, *, adapter=None, circuit=None, **client_kwargs: Any) -> ChatGateway:
    cfg: AIProviderSettings = config or default_settings
    route_adapters = None
    if adapter is None:
        routes = routes_from_settings(cfg, route_group=Scene.CHAT.value)
        route_adapters = {
            route.route_id: LangChainChatAdapter(config_for_route(cfg, route), **client_kwargs)
            for route in routes
        }
        adapter = route_adapters[routes[0].route_id]
    return ChatGateway(
        adapter=adapter,
        circuit=circuit if circuit is not None else _CIRCUIT,
        settings=cfg,
        route_adapters=route_adapters,
    )
