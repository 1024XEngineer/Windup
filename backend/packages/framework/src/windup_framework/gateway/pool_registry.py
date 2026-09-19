"""凭证池成员 → 运行时路由边。

Admit 与 Gateway 都通过 :func:`get_pool_snapshot` 读同一份快照。
P0 只从 env 物化：无 DB、不引入独立网关进程。
"""

from __future__ import annotations

import os
import time
from dataclasses import dataclass

from windup_framework.config.provider import AIProviderSettings, settings as default_settings
from windup_framework.gateway.pool_ids import default_account_id
from windup_framework.gateway.routes import GatewayRoute, routes_from_settings

_CACHE: dict[str, tuple[float, "PoolSnapshot"]] = {}


@dataclass(frozen=True)
class RoutableEdge:
    """可调度边。``route_id`` 与 ``credential_id`` 相同，禁止 ``primary.key{i}``。"""

    route_id: str
    credential_id: str
    endpoint_id: str
    account_id: str
    route_group: str
    candidate_index: int
    provider_name: str
    base_url: str
    api_key: str
    legacy_route_id: str
    selectable: bool = True

    def to_gateway_route(self) -> GatewayRoute:
        return GatewayRoute(
            route_id=self.route_id,
            route_group=self.route_group,
            candidate_index=self.candidate_index,
            provider_name=self.provider_name,
            base_url_id=self.endpoint_id,
            base_url=self.base_url,
            api_key_id=self.credential_id,
            api_key=self.api_key,
            legacy_route_id=self.legacy_route_id,
        )

    def redis_inflight_key(self) -> str:
        return f"windup:i2v:gate:inflight:cred:{self.credential_id}"

    def redis_cooling_key(self) -> str:
        return f"windup:i2v:gate:cooling:cred:{self.credential_id}"

    def redis_cooldown_key(self) -> str:
        return f"windup:i2v:gate:cooldown:cred:{self.credential_id}"

    def redis_shot_key(self) -> str:
        return f"windup:i2v:gate:shot:cred:{self.credential_id}"


@dataclass(frozen=True)
class PoolSnapshot:
    edges: tuple[RoutableEdge, ...]
    source: str  # "settings" | "test"

    def edges_for(
        self, route_group: str, *, selectable_only: bool = True
    ) -> tuple[RoutableEdge, ...]:
        out = [
            edge
            for edge in self.edges
            if edge.route_group == route_group and (not selectable_only or edge.selectable)
        ]
        return tuple(sorted(out, key=lambda edge: edge.candidate_index))

    def gateway_routes(self, route_group: str) -> tuple[GatewayRoute, ...]:
        return tuple(edge.to_gateway_route() for edge in self.edges_for(route_group))

    def edge_by_credential(self, route_group: str, cred: str) -> RoutableEdge | None:
        for edge in self.edges_for(route_group, selectable_only=False):
            if edge.credential_id == cred or edge.legacy_route_id == cred:
                return edge
        return None


def pool_cache_ttl_s() -> float:
    raw = os.getenv("WINDUP_GATEWAY_POOL_TTL_S", "").strip()
    if not raw:
        return 30.0
    return max(1.0, float(raw))


def invalidate_pool_cache() -> None:
    _CACHE.clear()


def _settings_fingerprint(cfg: AIProviderSettings) -> str:
    return "|".join(
        (
            cfg.provider,
            cfg.route_primary_name,
            cfg.effective_route_primary_base_url,
            cfg.effective_route_primary_api_key,
            cfg.route_primary_api_keys,
            cfg.route_fallback_name,
            cfg.route_fallback_base_url,
            cfg.route_fallback_api_key,
            cfg.route_fallback_api_keys,
        )
    )


def legacy_route_id_map(
    cfg: AIProviderSettings,
    *,
    route_group: str,
) -> dict[str, str]:
    """#842 ``primary.key{i}`` → 稳定 ``credential_id``（deploy 迁移一轮）。"""
    return {
        route.legacy_route_id: route.route_id
        for route in snapshot_from_settings(cfg, route_group=route_group).gateway_routes(
            route_group
        )
        if route.legacy_route_id
    }


def resolve_credential_id(
    route_id: str,
    *,
    cfg: AIProviderSettings | None = None,
    route_group: str,
) -> str:
    """task / i2v_state 里可能仍是旧 ``primary.key0``。"""
    if not route_id:
        return route_id
    cfg = cfg or default_settings
    snap = get_pool_snapshot(route_group, cfg=cfg)
    edge = snap.edge_by_credential(route_group, route_id)
    if edge is not None:
        return edge.credential_id
    return legacy_route_id_map(cfg, route_group=route_group).get(route_id, route_id)


def snapshot_from_settings(
    cfg: AIProviderSettings,
    *,
    route_group: str,
) -> PoolSnapshot:
    edges: list[RoutableEdge] = []
    for route in routes_from_settings(cfg, route_group=route_group):
        cred = route.route_id
        edges.append(
            RoutableEdge(
                route_id=cred,
                credential_id=cred,
                endpoint_id=route.base_url_id,
                account_id=default_account_id(cred),
                route_group=route_group,
                candidate_index=route.candidate_index,
                provider_name=route.provider_name,
                base_url=route.base_url,
                api_key=route.api_key,
                legacy_route_id=route.legacy_route_id,
            )
        )
    return PoolSnapshot(edges=tuple(edges), source="settings")


def get_pool_snapshot(
    route_group: str,
    *,
    cfg: AIProviderSettings | None = None,
) -> PoolSnapshot:
    """进程内 TTL 缓存；Admit 与 Gateway 统一入口。"""
    now = time.monotonic()
    cfg = cfg or default_settings
    cache_key = f"{route_group}:{_settings_fingerprint(cfg)}"
    cached = _CACHE.get(cache_key)
    if cached is not None and now - cached[0] < pool_cache_ttl_s():
        return cached[1]
    snap = snapshot_from_settings(cfg, route_group=route_group)
    _CACHE[cache_key] = (now, snap)
    return snap
