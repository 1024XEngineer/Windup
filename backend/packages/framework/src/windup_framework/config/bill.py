"""支付与账单系统配置。"""

from pydantic_settings import BaseSettings, SettingsConfigDict


class BillSettings(BaseSettings):
    """支付网关及账单系统配置。

    环境变量前缀 ``WINDUP_BILL_``。
    """

    model_config = SettingsConfigDict(
        env_prefix="WINDUP_BILL_",
        env_file=("../.env", ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    epay_pid: int = 0
    epay_private_key: str = ""
    epay_public_key: str = ""
    epay_notify_url: str = ""
    epay_return_url: str = ""
    epay_api_url: str = ""


settings = BillSettings()
