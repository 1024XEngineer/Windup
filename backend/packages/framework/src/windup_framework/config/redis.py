"""Redis 连接配置。"""

from pydantic_settings import BaseSettings, SettingsConfigDict


class RedisSettings(BaseSettings):
    """Redis 预留配置；只有 ``REDIS_ENABLED=true`` 时才允许创建客户端。"""

    model_config = SettingsConfigDict(
        env_prefix="REDIS_",
        env_file=("../.env", ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    enabled: bool = False
    url: str = "redis://127.0.0.1:6379/0"


settings = RedisSettings()
