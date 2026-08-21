from __future__ import annotations

from windup_framework.config.provider import AIProviderSettings
from windup_framework.gateway.routes import routes_from_settings


def test_gateway_route_env_fields_are_live():
    cfg = AIProviderSettings(
        route_primary_name="qnaigc",
        route_primary_base_url="https://api.qnaigc.com/v1",
        route_primary_api_key="primary-key",
        route_fallback_name="backup",
        route_fallback_base_url="https://backup.example.com/v1",
        route_fallback_api_key="backup-key",
    )

    assert cfg.route_primary_name == "qnaigc"
    assert cfg.route_primary_base_url == "https://api.qnaigc.com/v1"
    assert cfg.route_primary_api_key == "primary-key"
    assert cfg.route_fallback_name == "backup"
    assert cfg.route_fallback_base_url == "https://backup.example.com/v1"
    assert cfg.route_fallback_api_key == "backup-key"


def test_empty_gateway_route_values_disable_fallback_route():
    cfg = AIProviderSettings(
        base_url="https://api.qnaigc.com/v1/",
        api_key="legacy-key",
        route_primary_base_url="",
        route_primary_api_key="",
        route_fallback_name="",
        route_fallback_base_url="",
        route_fallback_api_key="",
    )

    assert cfg.effective_route_primary_base_url == "https://api.qnaigc.com/v1"
    assert cfg.effective_route_primary_api_key == "legacy-key"
    assert cfg.route_fallback_enabled is False


def test_routes_expand_extra_keys_on_same_base_url_before_fallback_url():
    cfg = AIProviderSettings(
        route_primary_name="primary",
        route_primary_base_url="https://api.qnaigc.com/v1",
        route_primary_api_key="key-a",
        route_primary_api_keys="key-b",
        route_fallback_name="backup",
        route_fallback_base_url="https://backup.example.com/v1",
        route_fallback_api_key="key-c",
    )
    routes = routes_from_settings(cfg, route_group="character_image")

    assert [(r.base_url_id, r.api_key, r.base_url) for r in routes] == [
        ("primary", "key-a", "https://api.qnaigc.com/v1"),
        ("primary", "key-b", "https://api.qnaigc.com/v1"),
        ("backup", "key-c", "https://backup.example.com/v1"),
    ]
    assert routes[0].api_key_id != routes[1].api_key_id
    assert routes[0].candidate_index == 0
    assert routes[1].candidate_index == 1
    assert routes[2].candidate_index == 2
