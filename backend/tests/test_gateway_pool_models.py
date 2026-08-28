from __future__ import annotations

from sqlalchemy import create_engine, inspect

from windup_framework.db import Base
from windup_framework.gateway.pool_models import (
    GatewayPoolAccount,
    GatewayPoolCapability,
    GatewayPoolCredential,
    GatewayPoolCredentialEndpoint,
    GatewayPoolEndpoint,
    QUOTA_SCOPE_CREDENTIAL,
)
from windup_framework.gateway.pool_registry import (
    RoutableEdge,
    snapshot_from_settings,
)


def test_pool_tables_are_registered():
    names = {
        GatewayPoolAccount.__tablename__,
        GatewayPoolEndpoint.__tablename__,
        GatewayPoolCredential.__tablename__,
        GatewayPoolCredentialEndpoint.__tablename__,
        GatewayPoolCapability.__tablename__,
    }
    assert names <= set(Base.metadata.tables.keys())


def test_pool_tables_can_be_created_in_sqlite():
    engine = create_engine("sqlite:///:memory:")
    try:
        Base.metadata.create_all(
            engine,
            tables=[
                GatewayPoolAccount.__table__,
                GatewayPoolEndpoint.__table__,
                GatewayPoolCredential.__table__,
                GatewayPoolCredentialEndpoint.__table__,
                GatewayPoolCapability.__table__,
            ],
        )
        live = set(inspect(engine).get_table_names())
        assert "windup_gateway_pool_account" in live
        assert "windup_gateway_pool_capability" in live
    finally:
        engine.dispose()


def test_snapshot_from_settings_maps_to_routable_edge(monkeypatch):
    monkeypatch.setenv("AI_ROUTE_PRIMARY_NAME", "primary")
    monkeypatch.setenv("AI_ROUTE_PRIMARY_BASE_URL", "https://example.com/v1")
    monkeypatch.setenv("AI_ROUTE_PRIMARY_API_KEY", "sk-one")
    monkeypatch.setenv("AI_ROUTE_PRIMARY_API_KEYS", "sk-two")
    from windup_framework.config.provider import AIProviderSettings

    cfg = AIProviderSettings()
    snap = snapshot_from_settings(cfg, route_group="character_action")
    assert snap.source == "settings"
    assert len(snap.edges) == 2
    edge = snap.edges[0]
    assert isinstance(edge, RoutableEdge)
    assert edge.quota_scope == QUOTA_SCOPE_CREDENTIAL
    assert edge.account_id == edge.credential_id
    assert edge.credential_id.startswith("primary:")
    assert ".key" not in edge.credential_id
    route = edge.to_gateway_route()
    assert route.base_url_id == "primary"
    assert route.api_key_id == route.route_id


def test_routable_edge_redis_keys_use_stable_ids():
    edge = RoutableEdge(
        route_id="cred-a",
        credential_id="cred-a",
        endpoint_id="primary",
        account_id="acct-1",
        quota_scope="account",
        route_group="character_action",
        candidate_index=0,
        provider_name="openai-compatible",
        base_url="https://example.com/v1",
        api_key="sk",
        account_inflight_max=2,
        credential_inflight_max=2,
        selectable=True,
    )
    assert edge.redis_inflight_key() == "windup:i2v:gate:inflight:cred:cred-a"
    assert edge.redis_account_inflight_key() == "windup:i2v:gate:inflight:acct:acct-1"
    assert edge.redis_cooling_key().endswith("acct:acct-1")
