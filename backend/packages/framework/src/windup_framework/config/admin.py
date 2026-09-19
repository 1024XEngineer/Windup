"""管理端访问控制配置。"""

from pydantic_settings import BaseSettings, SettingsConfigDict


class AdminSettings(BaseSettings):
    """从服务端环境变量读取管理员邮箱白名单。"""

    model_config = SettingsConfigDict(
        env_prefix="WINDUP_",
        env_file=("../.env", ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    admin_emails: str = ""

    @property
    def admin_email_set(self) -> frozenset[str]:
        """返回去重、去空白且不区分大小写的邮箱集合。"""
        return frozenset(
            email.strip().lower()
            for email in self.admin_emails.split(",")
            if email.strip()
        )


settings = AdminSettings()
