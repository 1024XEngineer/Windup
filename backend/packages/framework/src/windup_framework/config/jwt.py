"""JWT 配置。

从环境变量(或 ``.env``)读取,字段前缀 ``JWT_``。

``secret`` 为必填项,无代码默认值 — 缺失时 Pydantic 在实例化阶段直接抛出
``ValidationError``,进程在启动前即失败(fail-fast)。
"""

from pydantic import SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class JWTSettings(BaseSettings):
    """JWT 签名配置。"""

    model_config = SettingsConfigDict(
        env_prefix="JWT_",
        env_file=("../.env", ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    secret: SecretStr

    @field_validator("secret")
    @classmethod
    def _check_secret_strength(cls, v: SecretStr) -> SecretStr:
        raw = v.get_secret_value()
        if len(raw) < 32:
            raise ValueError(
                "JWT_SECRET 长度不足 32 字符,不符合安全要求。"
                "请使用至少 32 字符的随机密钥:\n"
                "  JWT_SECRET=$(openssl rand -hex 32)"
            )
        return v


settings = JWTSettings()
