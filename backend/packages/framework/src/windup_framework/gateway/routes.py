from __future__ import annotations

from dataclasses import dataclass
from urllib.parse import urlparse

from windup_framework.config.provider import AIProviderSettings


@dataclass(frozen=True)
class GatewayRoute:
    route_id: str
    route_group: str
    candidate_index: int
    provider_name: str
    base_url_id: str
    base_url: str
    api_key_id: str | None
    api_key: str

    @property
    def host(self) -> str | None:
        return urlparse(self.base_url).hostname


def _parse_csv(raw: str) -> tuple[str, ...]:
    return tuple(part.strip() for part in raw.split(",") if part.strip())


def _unique_keys(first: str, extra: str) -> tuple[str, ...]:
    keys: list[str] = []
    for key in (first.strip(), *_parse_csv(extra)):
        if key and key not in keys:
            keys.append(key)
    return tuple(keys) or ("",)


def _expand_url(
    *,
    route_group: str,
    provider_name: str,
    base_url_id: str,
    base_url: str,
    first_key: str,
    extra_keys: str,
    start_index: int,
) -> list[GatewayRoute]:
    routes: list[GatewayRoute] = []
    for i, api_key in enumerate(_unique_keys(first_key, extra_keys)):
        api_key_id = f"{base_url_id}.key{i}"
        routes.append(
            GatewayRoute(
                route_id=api_key_id,
                route_group=route_group,
                candidate_index=start_index + i,
                provider_name=provider_name,
                base_url_id=base_url_id,
                base_url=base_url,
                api_key_id=api_key_id,
                api_key=api_key,
            )
        )
    return routes


def routes_from_settings(cfg: AIProviderSettings, *, route_group: str) -> tuple[GatewayRoute, ...]:
    primary_name = cfg.route_primary_name.strip() or "primary"
    routes = _expand_url(
        route_group=route_group,
        provider_name=cfg.provider,
        base_url_id=primary_name,
        base_url=cfg.effective_route_primary_base_url,
        first_key=cfg.effective_route_primary_api_key,
        extra_keys=cfg.route_primary_api_keys,
        start_index=0,
    )
    if cfg.route_fallback_enabled:
        fallback_name = cfg.route_fallback_name.strip()
        routes.extend(
            _expand_url(
                route_group=route_group,
                provider_name=cfg.provider,
                base_url_id=fallback_name,
                base_url=cfg.route_fallback_base_url.rstrip("/"),
                first_key=cfg.route_fallback_api_key,
                extra_keys=cfg.route_fallback_api_keys,
                start_index=len(routes),
            )
        )
    return tuple(routes)


def config_for_route(cfg: AIProviderSettings, route: GatewayRoute) -> AIProviderSettings:
    return cfg.model_copy(update={"base_url": route.base_url, "api_key": route.api_key})


def lookup_adapter(route_adapters: dict, route: GatewayRoute, default):
    return (
        route_adapters.get(route.route_id)
        or route_adapters.get(route.api_key_id)
        or route_adapters.get(route.base_url_id)
        or default
    )


def key_circuit_id(route: GatewayRoute) -> str:
    return f"key:{route.base_url_id}:{route.api_key_id}"


def route_layer_for(reason: str) -> str:
    if reason == "base_url_unreached":
        return "base_url"
    if reason == "key_rate_limit":
        return "key"
    if reason in {
        "fallback_after_429",
        "fallback_after_upstream_fail",
        "skip_circuit_open",
        "start_from_caller",
    }:
        return "model"
    return "none"
