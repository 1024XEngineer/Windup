"""独立完美像素工具的本地资源配置。"""

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class PixelPerfectSettings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="PIXEL_PERFECT_",
        env_file=("../.env", ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    concurrency: int = Field(default=1, ge=1)


settings = PixelPerfectSettings()
