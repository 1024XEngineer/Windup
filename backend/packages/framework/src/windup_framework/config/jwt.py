"""JWT 配置。

从环境变量(或 ``.env``)读取,字段前缀 ``JWT_``。
"""

from pydantic_settings import BaseSettings, SettingsConfigDict


class JWTSettings(BaseSettings):
    """JWT 签名配置。"""

    model_config = SettingsConfigDict(
        env_prefix="JWT_",
        env_file=("../.env", ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    secret: str = "change-me-in-production"


settings = JWTSettings()
