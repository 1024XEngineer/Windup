"""Postgres 数据库连接配置。

从环境变量(或 ``.env``)读取,字段前缀 ``POSTGRES_``。

``password`` 为必填项,无代码默认值 — 缺失时 Pydantic 在实例化阶段直接抛出
``ValidationError``。本地开发请在 ``.env`` 或 ``.env.dev`` 中显式配置。
"""

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy import URL


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
    password: str = Field(...)          # 必填,无默认值
    db: str = Field(default="windup")
    pool_size: int = 5
    max_overflow: int = 10
    pool_pre_ping: bool = True

    @field_validator("password")
    @classmethod
    def _check_password_not_trivial(cls, v: str) -> str:
        if len(v) < 8:
            raise ValueError(
                "POSTGRES_PASSWORD 长度不足 8 字符。"
                "请使用强密码以保障数据库安全。"
            )
        return v

    @property
    def url(self) -> str:
        """SQLAlchemy 连接串(psycopg3 驱动)。

        用 ``URL.create`` 构造以正确转义密码中的保留字符(``@ : /`` 等),
        再渲染为 str 以保持返回类型契约。
        """
        return URL.create(
            drivername="postgresql+psycopg",
            username=self.user,
            password=self.password,
            host=self.host,
            port=self.port,
            database=self.db,
        ).render_as_string(hide_password=False)


settings = DatabaseSettings()
