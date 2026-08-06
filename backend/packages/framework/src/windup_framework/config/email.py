"""Resend 邮件服务配置。

从环境变量(或 ``.env``)读取,字段前缀 ``RESEND_``。
"""

from pydantic_settings import BaseSettings, SettingsConfigDict


class EmailSettings(BaseSettings):
    """Resend 邮件服务配置。"""

    model_config = SettingsConfigDict(
        env_prefix="RESEND_",
        env_file=("../.env", ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    api_key: str = ""
    from_email: str = "noreply@windup.dev"


settings = EmailSettings()
