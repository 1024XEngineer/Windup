from __future__ import annotations

from windup_framework.config.provider import AIProviderSettings
from windup_framework.gateway.pool_ids import credential_id, default_account_id
from windup_framework.gateway.pool_registry import (
    invalidate_pool_cache,
    snapshot_from_settings,
)
from windup_framework.gateway.routes import pool_routes, routes_from_settings


def test_credential_id_is_stable_for_same_key():
    a = credential_id("primary", "sk-secret")
    b = credential_id("primary", "sk-secret")
    assert a == b
    assert a.startswith("primary:")
    assert ".key" not in a


def test_credential_id_differs_for_different_keys():
    assert credential_id("primary", "sk-a") != credential_id("primary", "sk-b")


def test_default_account_id_matches_credential():
    cred = credential_id("primary", "sk-x")
    assert default_account_id(cred) == cred


def _cfg(*keys: str, extra: str = "") -> AIProviderSettings:
    first, *rest = keys
    return AIProviderSettings(
        route_primary_name="primary",
        route_primary_base_url="https://api.qnaigc.com/v1",
        route_primary_api_key=first,
        route_primary_api_keys=",".join(rest) if rest else extra,
        route_fallback_name="",
        route_fallback_base_url="",
        route_fallback_api_key="",
        route_fallback_api_keys="",
    )


def test_routes_use_stable_id_not_csv_index():
    routes = routes_from_settings(_cfg("key-a", "key-b"), route_group="character_action")
    assert routes[0].route_id == credential_id("primary", "key-a")
    assert routes[1].route_id == credential_id("primary", "key-b")
    assert routes[0].legacy_route_id == "primary.key0"
    assert routes[1].legacy_route_id == "primary.key1"
    assert routes[0].api_key_id == routes[0].route_id


def test_insert_or_delete_key_keeps_physical_credential_id():
    before = {r.api_key: r.route_id for r in routes_from_settings(
        _cfg("key-a", "key-b", "key-c"), route_group="character_image"
    )}
    inserted = {r.api_key: r.route_id for r in routes_from_settings(
        _cfg("key-new", "key-a", "key-b", "key-c"), route_group="character_image"
    )}
    deleted = {r.api_key: r.route_id for r in routes_from_settings(
        _cfg("key-a", "key-c"), route_group="character_image"
    )}
    assert inserted["key-a"] == before["key-a"]
    assert inserted["key-b"] == before["key-b"]
    assert inserted["key-c"] == before["key-c"]
    assert deleted["key-a"] == before["key-a"]
    assert deleted["key-c"] == before["key-c"]
    assert inserted["key-new"] != before["key-a"]


def test_pool_routes_match_snapshot():
    invalidate_pool_cache()
    cfg = _cfg("key-a", "key-b")
    snap = snapshot_from_settings(cfg, route_group="character_action")
    routes = pool_routes(cfg, route_group="character_action")
    assert snap.source == "settings"
    assert [r.route_id for r in routes] == [e.credential_id for e in snap.edges]
    assert all(".key" not in e.credential_id for e in snap.edges)
