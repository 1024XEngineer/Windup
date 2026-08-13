"""配置安全校验测试。

直接实例化 Settings 类,覆盖:
- 缺失必填字段 → ValidationError
- 空值 → ValidationError
- 弱值 / 格式错误 → ValidationError
- 合法值 → 正常通过

注意:测试中通过 ``_env_file=()`` 禁用 .env 文件读取,确保只受环境变量控制。
"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from windup_framework.config.database import DatabaseSettings
from windup_framework.config.jwt import JWTSettings


# ── 辅助:禁用 .env 文件的 fixture ────────────────────────────────

@pytest.fixture(autouse=True)
def _no_env_files(monkeypatch: pytest.MonkeyPatch):
    """禁止 Settings 从 .env 文件读取,测试只通过环境变量控制。"""
    monkeypatch.setattr(
        "windup_framework.config.jwt.JWTSettings.model_config",
        {**JWTSettings.model_config, "env_file": ()},
    )
    monkeypatch.setattr(
        "windup_framework.config.database.DatabaseSettings.model_config",
        {**DatabaseSettings.model_config, "env_file": ()},
    )


# ── JWT_SECRET ────────────────────────────────────────────────────

class TestJWTSettings:
    """``JWTSettings`` 校验:必填 + 最小长度 32 字符。"""

    def test_missing_secret_raises(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """JWT_SECRET 未设置 → ValidationError。"""
        monkeypatch.delenv("JWT_SECRET", raising=False)
        with pytest.raises(ValidationError, match="secret"):
            JWTSettings()

    def test_empty_secret_raises(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """JWT_SECRET 为空字符串 → ValidationError。"""
        monkeypatch.setenv("JWT_SECRET", "")
        with pytest.raises(ValidationError, match="secret"):
            JWTSettings()

    def test_short_secret_raises(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """JWT_SECRET 不足 32 字符 → ValidationError。"""
        monkeypatch.setenv("JWT_SECRET", "short-key")
        with pytest.raises(ValidationError, match="32"):
            JWTSettings()

    def test_exactly_31_chars_raises(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """JWT_SECRET 恰好 31 字符 → 不满足 ≥32,拒绝。"""
        monkeypatch.setenv("JWT_SECRET", "a" * 31)
        with pytest.raises(ValidationError, match="32"):
            JWTSettings()

    def test_exactly_32_chars_passes(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """JWT_SECRET 恰好 32 字符 → 边界通过。"""
        monkeypatch.setenv("JWT_SECRET", "b" * 32)
        s = JWTSettings()
        assert s.secret.get_secret_value() == "b" * 32

    def test_valid_secret_passes(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """JWT_SECRET 足够长且随机 → 正常构造。"""
        monkeypatch.setenv("JWT_SECRET", "a" * 64)
        s = JWTSettings()
        assert len(s.secret.get_secret_value()) == 64


# ── POSTGRES_PASSWORD ────────────────────────────────────────────

class TestDatabaseSettings:
    """``DatabaseSettings`` 校验:必填 + 最小长度 8 字符。"""

    def test_missing_password_raises(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """POSTGRES_PASSWORD 未设置 → ValidationError。"""
        monkeypatch.delenv("POSTGRES_PASSWORD", raising=False)
        with pytest.raises(ValidationError, match="password"):
            DatabaseSettings()

    def test_empty_password_raises(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """POSTGRES_PASSWORD 为空字符串 → ValidationError。"""
        monkeypatch.setenv("POSTGRES_PASSWORD", "")
        with pytest.raises(ValidationError, match="password"):
            DatabaseSettings()

    def test_short_password_raises(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """POSTGRES_PASSWORD 不足 8 字符 → ValidationError。"""
        monkeypatch.setenv("POSTGRES_PASSWORD", "short")
        with pytest.raises(ValidationError, match="8"):
            DatabaseSettings()

    def test_exactly_7_chars_raises(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """POSTGRES_PASSWORD 恰好 7 字符 → 不满足 ≥8,拒绝。"""
        monkeypatch.setenv("POSTGRES_PASSWORD", "a" * 7)
        with pytest.raises(ValidationError, match="8"):
            DatabaseSettings()

    def test_exactly_8_chars_passes(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """POSTGRES_PASSWORD 恰好 8 字符 → 边界通过。"""
        monkeypatch.setenv("POSTGRES_PASSWORD", "a" * 8)
        s = DatabaseSettings()
        assert s.password == "a" * 8

    def test_valid_password_passes(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """POSTGRES_PASSWORD 合法 → 正常构造。"""
        monkeypatch.setenv("POSTGRES_PASSWORD", "strongpassword123")
        s = DatabaseSettings()
        assert s.password == "strongpassword123"

    def test_url_property_works(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """合法密码下,url 属性应正常返回连接串。"""
        monkeypatch.setenv("POSTGRES_PASSWORD", "my_strong_pw")
        s = DatabaseSettings()
        assert "postgresql+psycopg" in s.url
        assert "my_strong_pw" in s.url


# ── 两者同时缺失 ──────────────────────────────────────────────────

class TestBothMissing:
    """JWT_SECRET 和 POSTGRES_PASSWORD 同时缺失。"""

    def test_both_missing_raises_on_jwt(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """两个都缺 → JWTSettings 先抛 ValidationError(Pydantic fail-fast)。"""
        monkeypatch.delenv("JWT_SECRET", raising=False)
        monkeypatch.delenv("POSTGRES_PASSWORD", raising=False)
        with pytest.raises(ValidationError):
            JWTSettings()

    def test_both_missing_raises_on_db(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """两个都缺 → DatabaseSettings 同样抛 ValidationError。"""
        monkeypatch.delenv("JWT_SECRET", raising=False)
        monkeypatch.delenv("POSTGRES_PASSWORD", raising=False)
        with pytest.raises(ValidationError):
            DatabaseSettings()
