"""framework 配置。"""

from windup_framework.config.database import DatabaseSettings, settings
from windup_framework.config.storage import StorageSettings, settings as storage_settings

__all__ = ["DatabaseSettings", "settings", "StorageSettings", "storage_settings"]
