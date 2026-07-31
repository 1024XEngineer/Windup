"""framework 配置。"""

from windup_framework.config.database import DatabaseSettings, settings
from windup_framework.config.provider import AIProviderSettings, settings as provider_settings
from windup_framework.config.storage import StorageSettings, settings as storage_settings

__all__ = [
    "AIProviderSettings",
    "DatabaseSettings",
    "StorageSettings",
    "provider_settings",
    "settings",
    "storage_settings",
]
