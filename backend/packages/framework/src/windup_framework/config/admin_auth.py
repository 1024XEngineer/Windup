"""独立管理员认证的引导配置。"""

from pydantic import Field, SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class AdminAuthSettings(BaseSettings):
    """管理员 JWT、Cookie 与会话时长配置。"""

    model_config = SettingsConfigDict(
        env_prefix="ADMIN_",
        env_file=("../.env", ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    jwt_secret: SecretStr
    access_token_ttl_seconds: int = Field(default=15 * 60, ge=60, le=24 * 3600)
    refresh_token_ttl_seconds: int = Field(
        default=7 * 24 * 3600,
        ge=5 * 60,
        le=90 * 24 * 3600,
    )
    cookie_secure: bool = True
    cookie_domain: str = ""

    @field_validator("jwt_secret")
    @classmethod
    def _check_secret_strength(cls, value: SecretStr) -> SecretStr:
        if len(value.get_secret_value()) < 32:
            raise ValueError("ADMIN_JWT_SECRET 长度不得少于 32 字符")
        return value

    @field_validator("cookie_domain")
    @classmethod
    def _normalize_cookie_domain(cls, value: str) -> str:
        return value.strip().lstrip(".")


settings = AdminAuthSettings()
