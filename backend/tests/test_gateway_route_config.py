from __future__ import annotations

from windup_framework.config.provider import AIProviderSettings


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
