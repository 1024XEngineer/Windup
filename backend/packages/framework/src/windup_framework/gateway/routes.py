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


def routes_from_settings(cfg: AIProviderSettings, *, route_group: str) -> tuple[GatewayRoute, ...]:
    primary_name = cfg.route_primary_name.strip() or "primary"
    routes = [
        GatewayRoute(
            route_id=f"{primary_name}.primary",
            route_group=route_group,
            candidate_index=0,
            provider_name=cfg.provider,
            base_url_id=primary_name,
            base_url=cfg.effective_route_primary_base_url,
            api_key_id=primary_name,
            api_key=cfg.effective_route_primary_api_key,
        )
    ]
    if cfg.route_fallback_enabled:
        fallback_name = cfg.route_fallback_name.strip()
        routes.append(
            GatewayRoute(
                route_id=f"{fallback_name}.fallback",
                route_group=route_group,
                candidate_index=1,
                provider_name=cfg.provider,
                base_url_id=fallback_name,
                base_url=cfg.route_fallback_base_url.rstrip("/"),
                api_key_id=fallback_name,
                api_key=cfg.route_fallback_api_key,
            )
        )
    return tuple(routes)


def config_for_route(cfg: AIProviderSettings, route: GatewayRoute) -> AIProviderSettings:
    return cfg.model_copy(update={"base_url": route.base_url, "api_key": route.api_key})


def route_layer_for(reason: str) -> str:
    if reason == "base_url_unreached":
        return "base_url"
    if reason in {
        "fallback_after_429",
        "fallback_after_upstream_fail",
        "skip_circuit_open",
        "start_from_caller",
    }:
        return "model"
    return "none"
