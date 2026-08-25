"""framework 配置。

各配置子模块首次使用时仍会立即完成 Pydantic 校验；包入口按需导入，避免只使用
Provider 的独立工具被无关的数据库或存储凭据阻塞。
"""

from importlib import import_module

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

_EXPORTS = {
    "AIProviderSettings": ("windup_framework.config.provider", "AIProviderSettings"),
    "DatabaseSettings": ("windup_framework.config.database", "DatabaseSettings"),
    "JWTSettings": ("windup_framework.config.jwt", "JWTSettings"),
    "StorageSettings": ("windup_framework.config.storage", "StorageSettings"),
    "provider_settings": ("windup_framework.config.provider", "settings"),
    "settings": ("windup_framework.config.database", "settings"),
    "jwt_settings": ("windup_framework.config.jwt", "settings"),
    "storage_settings": ("windup_framework.config.storage", "settings"),
}


def __getattr__(name: str):
    try:
        module_name, attribute = _EXPORTS[name]
    except KeyError as exc:
        raise AttributeError(name) from exc
    value = getattr(import_module(module_name), attribute)
    globals()[name] = value
    return value
