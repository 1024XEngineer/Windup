"""真实 Provider 八方向验收入口的 fail-closed 单元测试。"""

from __future__ import annotations

import io
import importlib
import json
import os
import subprocess
import sys

import pytest
from PIL import Image

from windup_app.acceptance.full_direction_provider import (
    AcceptanceConfigurationError,
    inspect_image,
    require_live_configuration,
    run_live_acceptance,
)
from windup_framework.config.provider import AIProviderSettings
from windup_framework.gateway.registry import RegistryError


def _png() -> bytes:
    output = io.BytesIO()
    Image.new("RGBA", (32, 48), (20, 40, 60, 255)).save(output, "PNG")
    return output.getvalue()


def test_live_acceptance_requires_explicit_spend_authorization() -> None:
    settings = AIProviderSettings(
        api_key="real-key",
        base_url="https://provider.example.com/v1",
        image_model="image-model",
    )

    with pytest.raises(AcceptanceConfigurationError, match="--allow-spend"):
        require_live_configuration(settings, allow_spend=False)


def test_live_acceptance_rejects_missing_provider_credentials() -> None:
    settings = AIProviderSettings(
        api_key="",
        route_primary_api_key="",
        base_url="https://provider.example.com/v1",
        image_model="image-model",
    )

    with pytest.raises(AcceptanceConfigurationError, match="AI_API_KEY"):
        require_live_configuration(settings, allow_spend=True)


def test_live_acceptance_accepts_primary_route_credentials() -> None:
    settings = AIProviderSettings(
        api_key="",
        route_primary_api_key="route-key",
        base_url="https://provider.example.com/v1",
        image_model="image-model",
    )

    require_live_configuration(settings, allow_spend=True)


@pytest.mark.parametrize(
    ("overrides", "message"),
    [
        ({"base_url": ""}, "AI_BASE_URL"),
        ({"image_model": ""}, "AI_IMAGE_MODEL"),
    ],
)
def test_live_acceptance_rejects_incomplete_provider_route(overrides, message) -> None:
    values = {
        "api_key": "configured-key",
        "base_url": "https://provider.example.com/v1",
        "image_model": "gemini-2.5-flash-image",
        **overrides,
    }
    settings = AIProviderSettings(**values)

    with pytest.raises(AcceptanceConfigurationError, match=message):
        require_live_configuration(settings, allow_spend=True)


def test_inspect_image_verifies_and_hashes_real_png_bytes() -> None:
    result = inspect_image(_png())

    assert result.format == "PNG"
    assert result.width == 32
    assert result.height == 48
    assert result.byte_count > 0
    assert len(result.sha256) == 64


def test_inspect_image_rejects_undecodable_provider_body() -> None:
    with pytest.raises(ValueError, match="无法解码"):
        inspect_image(b"not-an-image")


def test_inspect_image_rejects_decodable_but_unsupported_format() -> None:
    output = io.BytesIO()
    Image.new("RGB", (8, 8), "red").save(output, "GIF")

    with pytest.raises(ValueError, match="GIF"):
        inspect_image(output.getvalue())


def test_live_acceptance_records_preflight_gateway_failure_without_network(
    tmp_path,
) -> None:
    settings = AIProviderSettings(
        api_key="configured-key",
        base_url="https://provider.example.com/v1",
        image_model="unregistered-image-model",
    )
    output_dir = tmp_path / "evidence"

    with pytest.raises(RegistryError, match="未登记型号"):
        run_live_acceptance(
            settings,
            allow_spend=True,
            base_prompt="original hero",
            output_dir=output_dir,
        )

    manifest = json.loads((output_dir / "manifest.json").read_text(encoding="utf-8"))
    assert manifest["status"] == "failed"
    assert manifest["error_type"] == "RegistryError"
    assert manifest["provider_origin"] == "https://provider.example.com"
    assert manifest["expected_directions"] == [
        "east",
        "west",
        "north",
        "south",
        "north_east",
        "north_west",
        "south_east",
        "south_west",
    ]
    assert manifest["results"] == []


def test_acceptance_cli_does_not_require_unrelated_database_config() -> None:
    env = os.environ.copy()
    for key in tuple(env):
        if key.startswith(("POSTGRES_", "DATABASE_", "JWT_", "STORAGE_")):
            env.pop(key)

    result = subprocess.run(
        [sys.executable, "-m", "windup_app.acceptance.full_direction_provider"],
        capture_output=True,
        check=False,
        env=env,
        text=True,
    )

    assert result.returncode != 0
    assert "--allow-spend" in result.stderr
    assert "POSTGRES_PASSWORD" not in result.stderr


def test_lazy_package_exports_preserve_public_gateway_and_config_api() -> None:
    import windup_framework.config as config_package
    import windup_framework.gateway as gateway_package

    config_package.__dict__.pop("AIProviderSettings", None)
    gateway_package.__dict__.pop("build_image_gateway", None)

    assert config_package.AIProviderSettings is AIProviderSettings
    assert gateway_package.build_image_gateway.__name__ == "build_image_gateway"
    with pytest.raises(AttributeError):
        getattr(config_package, "missing_config_export")
    with pytest.raises(AttributeError):
        getattr(gateway_package, "missing_gateway_export")

    importlib.reload(config_package)
    importlib.reload(gateway_package)
