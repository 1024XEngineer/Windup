"""Redis 连接配置。

从环境变量(或 ``.env``)读取,字段前缀 ``REDIS_``。
本地开发默认值 ``redis://localhost:6379/0``。
"""

from pydantic_settings import BaseSettings, SettingsConfigDict


class RedisSettings(BaseSettings):
    """Redis 连接配置。"""

    model_config = SettingsConfigDict(
        env_prefix="REDIS_",
        env_file=("../.env", ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    url: str = "redis://localhost:6379/0"


settings = RedisSettings()
