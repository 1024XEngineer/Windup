"""凭证池成员表 → 运行时路由边的物化层。

Admit 与 Gateway 都应通过 :func:`get_pool_snapshot` 读取同一份快照。
"""

from __future__ import annotations

import os
import time
from dataclasses import dataclass
from typing import Sequence

from windup_framework.config.provider import AIProviderSettings, settings as default_settings
from windup_framework.gateway.pool_ids import credential_id, default_account_id
from windup_framework.gateway.pool_models import (
    POOL_STATUS_ACTIVE,
    QUOTA_SCOPE_ACCOUNT,
    QUOTA_SCOPE_CREDENTIAL,
)
from windup_framework.gateway.routes import GatewayRoute, routes_from_settings

_CACHE: dict[str, tuple[float, "PoolSnapshot"]] = {}


@dataclass(frozen=True)
class RoutableEdge:
    """可调度边；``route_id`` 与 ``credential_id`` 相同。"""

    route_id: str
    credential_id: str
    endpoint_id: str
    account_id: str
    quota_scope: str
    route_group: str
    candidate_index: int
    provider_name: str
    base_url: str
    api_key: str
    account_inflight_max: int
    credential_inflight_max: int | None
    selectable: bool

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
        )

    def redis_inflight_key(self) -> str:
        return f"windup:i2v:gate:inflight:cred:{self.credential_id}"

    def redis_account_inflight_key(self) -> str:
        return f"windup:i2v:gate:inflight:acct:{self.account_id}"

    def redis_cooling_key(self) -> str:
        if self.quota_scope == QUOTA_SCOPE_ACCOUNT:
            return f"windup:i2v:gate:cooling:acct:{self.account_id}"
        return f"windup:i2v:gate:cooling:cred:{self.credential_id}"

    def redis_cooldown_key(self) -> str:
        if self.quota_scope == QUOTA_SCOPE_ACCOUNT:
            return f"windup:i2v:gate:cooldown:acct:{self.account_id}"
        return f"windup:i2v:gate:cooldown:cred:{self.credential_id}"

    def redis_shot_key(self) -> str:
        if self.quota_scope == QUOTA_SCOPE_ACCOUNT:
            return f"windup:i2v:gate:shot:acct:{self.account_id}"
        return f"windup:i2v:gate:shot:cred:{self.credential_id}"


@dataclass(frozen=True)
class PoolSnapshot:
    edges: tuple[RoutableEdge, ...]
    source: str  # "settings" | "database" | "test"

    def edges_for(self, route_group: str, *, selectable_only: bool = True) -> tuple[RoutableEdge, ...]:
        out = [
            e
            for e in self.edges
            if e.route_group == route_group and (not selectable_only or e.selectable)
        ]
        return tuple(sorted(out, key=lambda e: e.candidate_index))

    def gateway_routes(self, route_group: str) -> tuple[GatewayRoute, ...]:
        return tuple(e.to_gateway_route() for e in self.edges_for(route_group))

    def lane_ids(self, route_group: str) -> tuple[str, ...]:
        return tuple(e.credential_id for e in self.edges_for(route_group))

    def edge_by_credential(self, route_group: str, cred: str) -> RoutableEdge | None:
        for edge in self.edges_for(route_group, selectable_only=False):
            if edge.credential_id == cred:
                return edge
        return None


def pool_cache_ttl_s() -> float:
    raw = os.getenv("WINDUP_GATEWAY_POOL_TTL_S", "").strip()
    if not raw:
        return 30.0
    return max(1.0, float(raw))


def invalidate_pool_cache(route_group: str | None = None) -> None:
    if route_group is None:
        _CACHE.clear()
        return
    drop = [k for k in _CACHE if k.startswith(f"{route_group}:")]
    for key in drop:
        _CACHE.pop(key, None)


def _settings_fingerprint(cfg: AIProviderSettings) -> str:
    parts = (
        cfg.provider,
        cfg.route_primary_name,
        cfg.route_primary_base_url,
        cfg.route_primary_api_key,
        cfg.route_primary_api_keys,
        cfg.route_fallback_name,
        cfg.route_fallback_base_url,
        cfg.route_fallback_api_key,
        cfg.route_fallback_api_keys,
    )
    return "|".join(parts)


def _default_inflight_max() -> int:
    raw = os.getenv("WINDUP_I2V_INFLIGHT_MAX", "").strip()
    if not raw:
        return 2
    return max(1, int(raw))


def legacy_route_id_map(
    cfg: AIProviderSettings,
    *,
    route_group: str,
) -> dict[str, str]:
    """#842 ``primary.key{i}`` → 稳定 ``credential_id``（deploy 迁移一轮）。"""
    out: dict[str, str] = {}
    for route in routes_from_settings(cfg, route_group=route_group):
        stable = credential_id(route.base_url_id, route.api_key)
        out[route.route_id] = stable
    return out


def resolve_credential_id(
    route_id: str,
    *,
    cfg: AIProviderSettings | None = None,
    route_group: str,
) -> str:
    """task / i2v_state 里可能是旧 ``primary.key0``。"""
    if not route_id:
        return route_id
    cfg = cfg or default_settings
    snap = get_pool_snapshot(route_group, cfg=cfg)
    if snap.edge_by_credential(route_group, route_id) is not None:
        return route_id
    return legacy_route_id_map(cfg, route_group=route_group).get(route_id, route_id)


def snapshot_from_settings(
    cfg: AIProviderSettings,
    *,
    route_group: str,
    inflight_max: int | None = None,
) -> PoolSnapshot:
    cap = inflight_max if inflight_max is not None else _default_inflight_max()
    edges: list[RoutableEdge] = []
    for route in routes_from_settings(cfg, route_group=route_group):
        cred = credential_id(route.base_url_id, route.api_key)
        acct = default_account_id(cred)
        edges.append(
            RoutableEdge(
                route_id=cred,
                credential_id=cred,
                endpoint_id=route.base_url_id,
                account_id=acct,
                quota_scope=QUOTA_SCOPE_CREDENTIAL,
                route_group=route_group,
                candidate_index=route.candidate_index,
                provider_name=route.provider_name,
                base_url=route.base_url,
                api_key=route.api_key,
                account_inflight_max=cap,
                credential_inflight_max=cap,
                selectable=True,
            )
        )
    return PoolSnapshot(edges=tuple(edges), source="settings")


def snapshot_from_rows(
    *,
    accounts: Sequence,
    endpoints: Sequence,
    credentials: Sequence,
    bindings: Sequence,
    route_group: str,
    decrypt_api_key,
) -> PoolSnapshot:
    endpoint_by_id = {e.endpoint_id: e for e in endpoints}
    account_by_id = {a.account_id: a for a in accounts}
    cred_by_id = {c.credential_id: c for c in credentials}

    edges: list[RoutableEdge] = []
    ordered = sorted(
        [b for b in bindings if b.route_group == route_group],
        key=lambda b: (b.priority, b.credential_id, b.endpoint_id),
    )
    for index, binding in enumerate(ordered):
        cred = cred_by_id.get(binding.credential_id)
        ep = endpoint_by_id.get(binding.endpoint_id)
        if cred is None or ep is None:
            continue
        acct = account_by_id.get(cred.account_id)
        if acct is None:
            continue
        selectable = (
            binding.status == POOL_STATUS_ACTIVE
            and cred.status == POOL_STATUS_ACTIVE
            and ep.status == POOL_STATUS_ACTIVE
            and acct.status == POOL_STATUS_ACTIVE
        )
        edges.append(
            RoutableEdge(
                route_id=cred.credential_id,
                credential_id=cred.credential_id,
                endpoint_id=ep.endpoint_id,
                account_id=acct.account_id,
                quota_scope=acct.quota_scope,
                route_group=route_group,
                candidate_index=index,
                provider_name=ep.provider_name,
                base_url=ep.base_url.rstrip("/"),
                api_key=decrypt_api_key(cred.api_key_ciphertext),
                account_inflight_max=acct.inflight_max,
                credential_inflight_max=cred.credential_inflight_max,
                selectable=selectable,
            )
        )
    return PoolSnapshot(edges=tuple(edges), source="database")


def load_snapshot(
    cfg: AIProviderSettings,
    *,
    route_group: str,
    session=None,
    decrypt_api_key=None,
) -> PoolSnapshot:
    if session is not None and decrypt_api_key is not None:
        from windup_framework.gateway.pool_models import (
            GatewayPoolAccount,
            GatewayPoolCredential,
            GatewayPoolCredentialEndpoint,
            GatewayPoolEndpoint,
        )

        bindings = session.query(GatewayPoolCredentialEndpoint).all()
        if bindings:
            return snapshot_from_rows(
                accounts=session.query(GatewayPoolAccount).all(),
                endpoints=session.query(GatewayPoolEndpoint).all(),
                credentials=session.query(GatewayPoolCredential).all(),
                bindings=bindings,
                route_group=route_group,
                decrypt_api_key=decrypt_api_key,
            )
    return snapshot_from_settings(cfg, route_group=route_group)


def get_pool_snapshot(
    route_group: str,
    *,
    cfg: AIProviderSettings | None = None,
    session=None,
    decrypt_api_key=None,
) -> PoolSnapshot:
    """进程内 TTL 缓存；Admit 与 Gateway 统一入口。"""
    now = time.monotonic()
    cfg = cfg or default_settings
    cache_key = f"{route_group}:{_settings_fingerprint(cfg)}"
    cached = _CACHE.get(cache_key)
    if cached is not None and now - cached[0] < pool_cache_ttl_s():
        return cached[1]
    snap = load_snapshot(
        cfg,
        route_group=route_group,
        session=session,
        decrypt_api_key=decrypt_api_key,
    )
    _CACHE[cache_key] = (now, snap)
    return snap
