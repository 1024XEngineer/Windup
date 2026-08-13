"""启动安全校验测试。

覆盖场景:
- JWT_SECRET 使用默认值 → 任何环境都拒绝启动
- POSTGRES_PASSWORD 使用默认值 → 生产环境拒绝,开发环境警告
- 两者都已配置 → 正常通过
"""

from __future__ import annotations

import pytest

from windup_framework.config import (
    _INSECURE_DB_PASSWORD,
    _INSECURE_JWT_SECRET,
    validate_settings,
)


class TestValidateSettings:
    """``validate_settings`` 单元测试。"""

    def test_jwt_default_raises(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """JWT_SECRET 为默认值时,任何环境下都应拒绝启动。"""
        monkeypatch.setattr(
            "windup_framework.config.jwt_settings",
            type("S", (), {"secret": _INSECURE_JWT_SECRET})(),
        )
        monkeypatch.setattr(
            "windup_framework.config.settings",
            type("S", (), {"password": "real-password"})(),
        )
        monkeypatch.delenv("WINDUP_ENV", raising=False)

        with pytest.raises(RuntimeError, match="JWT_SECRET"):
            validate_settings()

    def test_jwt_default_raises_in_dev(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """即使 WINDUP_ENV=dev,JWT 默认值也应拒绝。"""
        monkeypatch.setattr(
            "windup_framework.config.jwt_settings",
            type("S", (), {"secret": _INSECURE_JWT_SECRET})(),
        )
        monkeypatch.setattr(
            "windup_framework.config.settings",
            type("S", (), {"password": "real-password"})(),
        )
        monkeypatch.setenv("WINDUP_ENV", "dev")

        with pytest.raises(RuntimeError, match="JWT_SECRET"):
            validate_settings()

    def test_db_default_raises_in_production(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """POSTGRES_PASSWORD 为默认值时,生产环境应拒绝启动。"""
        monkeypatch.setattr(
            "windup_framework.config.jwt_settings",
            type("S", (), {"secret": "real-secret"})(),
        )
        monkeypatch.setattr(
            "windup_framework.config.settings",
            type("S", (), {"password": _INSECURE_DB_PASSWORD})(),
        )
        monkeypatch.delenv("WINDUP_ENV", raising=False)

        with pytest.raises(RuntimeError, match="POSTGRES_PASSWORD"):
            validate_settings()

    def test_db_default_warns_in_dev(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """POSTGRES_PASSWORD 为默认值时,开发环境应警告但不拒绝。"""
        monkeypatch.setattr(
            "windup_framework.config.jwt_settings",
            type("S", (), {"secret": "real-secret"})(),
        )
        monkeypatch.setattr(
            "windup_framework.config.settings",
            type("S", (), {"password": _INSECURE_DB_PASSWORD})(),
        )
        monkeypatch.setenv("WINDUP_ENV", "dev")

        # 不应抛出异常
        validate_settings()

    def test_both_default_raises_combined(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """JWT 和数据库都使用默认值时,错误消息应包含两者。"""
        monkeypatch.setattr(
            "windup_framework.config.jwt_settings",
            type("S", (), {"secret": _INSECURE_JWT_SECRET})(),
        )
        monkeypatch.setattr(
            "windup_framework.config.settings",
            type("S", (), {"password": _INSECURE_DB_PASSWORD})(),
        )
        monkeypatch.delenv("WINDUP_ENV", raising=False)

        with pytest.raises(RuntimeError) as exc_info:
            validate_settings()

        msg = str(exc_info.value)
        assert "JWT_SECRET" in msg
        assert "POSTGRES_PASSWORD" in msg

    def test_all_configured_passes(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """所有凭据已正确配置时,应正常通过。"""
        monkeypatch.setattr(
            "windup_framework.config.jwt_settings",
            type("S", (), {"secret": "my-super-secret-key"})(),
        )
        monkeypatch.setattr(
            "windup_framework.config.settings",
            type("S", (), {"password": "strong-password-123"})(),
        )
        monkeypatch.delenv("WINDUP_ENV", raising=False)

        # 不应抛出任何异常
        validate_settings()
