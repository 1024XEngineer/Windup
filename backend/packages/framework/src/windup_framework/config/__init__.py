"""framework 配置。

所有安全敏感字段(JWT_SECRET、POSTGRES_PASSWORD)均为必填项,
Pydantic Settings 在模块导入(实例化)时即完成校验,缺失或不合规直接抛出
``ValidationError`` — 进程在启动前失败(fail-fast)。
"""

from windup_framework.config.database import DatabaseSettings, settings
from windup_framework.config.jwt import JWTSettings, settings as jwt_settings
from windup_framework.config.provider import AIProviderSettings, settings as provider_settings
from windup_framework.config.storage import StorageSettings, settings as storage_settings

__all__ = [
    "AIProviderSettings",
    "DatabaseSettings",
    "JWTSettings",
    "StorageSettings",
    "provider_settings",
    "settings",
    "jwt_settings",
    "storage_settings",
]
