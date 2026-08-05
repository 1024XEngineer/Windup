"""数据库连接配置。

优先使用 SQLite(通过 SQLITE_PATH 环境变量),否则回退到 PostgreSQL。
"""

import os

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy import URL


class DatabaseSettings(BaseSettings):
    """数据库连接配置。"""

    model_config = SettingsConfigDict(
        env_prefix="POSTGRES_",
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
        """SQLAlchemy 连接串。

        若设置 SQLITE_PATH 环境变量则使用 SQLite,否则连接 PostgreSQL。
        """
        sqlite_path = os.getenv("SQLITE_PATH")
        if sqlite_path:
            return f"sqlite:///{sqlite_path}"

        return URL.create(
            drivername="postgresql+psycopg",
            username=self.user,
            password=self.password,
            host=self.host,
            port=self.port,
            database=self.db,
        ).render_as_string(hide_password=False)


settings = DatabaseSettings()
