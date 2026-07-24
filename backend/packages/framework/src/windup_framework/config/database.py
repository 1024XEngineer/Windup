"""Postgres 数据库连接配置。

从环境变量(或 ``.env``)读取,字段前缀 ``POSTGRES_``。
本地开发默认值对应 Docker 容器 root/admin123@localhost:4000。
"""

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class DatabaseSettings(BaseSettings):
    """数据库连接配置。"""

    model_config = SettingsConfigDict(
        env_prefix="POSTGRES_",
        # 兼容从 backend/ 或项目根运行:../.env 覆盖根目录,.env 覆盖当前目录
        env_file=("../.env", ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    host: str = "localhost"
    port: int = 4000
    user: str = "root"
    password: str = "admin123"
    db: str = Field(default="windup")
    pool_size: int = 5
    max_overflow: int = 10
    pool_pre_ping: bool = True

    @property
    def url(self) -> str:
        """SQLAlchemy 连接串(psycopg3 驱动)。"""
        return (
            f"postgresql+psycopg://{self.user}:{self.password}"
            f"@{self.host}:{self.port}/{self.db}"
        )


settings = DatabaseSettings()
