"""framework 配置。"""

import logging
import os

from windup_framework.config.database import DatabaseSettings, settings
from windup_framework.config.jwt import JWTSettings, settings as jwt_settings
from windup_framework.config.provider import AIProviderSettings, settings as provider_settings
from windup_framework.config.storage import StorageSettings, settings as storage_settings

logger = logging.getLogger(__name__)

__all__ = [
    "AIProviderSettings",
    "DatabaseSettings",
    "JWTSettings",
    "StorageSettings",
    "provider_settings",
    "settings",
    "jwt_settings",
    "storage_settings",
    "validate_settings",
]

# ── 硬编码默认凭据 ──────────────────────────────────────────────
_INSECURE_JWT_SECRET = "change-me-in-production"
_INSECURE_DB_PASSWORD = "admin123"


def validate_settings() -> None:
    """启动时校验关键配置,防止生产环境使用硬编码默认凭据。

    校验规则:
    1. ``JWT_SECRET`` 不能是公开的默认值 — 任何环境都不允许。
    2. ``POSTGRES_PASSWORD`` 不能是默认示例值 — 生产环境直接拒绝,
       开发环境仅警告。

    可通过 ``WINDUP_ENV=dev`` 或 ``WINDUP_ENV=test`` 跳过数据库密码校验
    (JWT 密钥始终校验)。
    """
    env = os.getenv("WINDUP_ENV", "production").strip().lower()
    is_dev = env in ("dev", "development", "test", "local")

    errors: list[str] = []
    warnings: list[str] = []

    # 1) JWT secret — 任何环境下都不能用默认值
    if jwt_settings.secret == _INSECURE_JWT_SECRET:
        errors.append(
            "JWT_SECRET 仍在使用公开的默认值 'change-me-in-production',"
            "任何人都可以伪造有效 token。"
            "请在环境变量或 .env 中设置一个随机密钥:\n"
            "  JWT_SECRET=$(openssl rand -hex 32)"
        )

    # 2) 数据库密码
    if settings.password == _INSECURE_DB_PASSWORD:
        if is_dev:
            warnings.append(
                "POSTGRES_PASSWORD 仍在使用默认值 'admin123',"
                "本地开发可以但请确保不要在生产环境使用此密码。"
            )
        else:
            errors.append(
                "POSTGRES_PASSWORD 仍在使用默认值 'admin123',"
                "生产环境必须设置强密码。"
                "请在环境变量或 .env 中设置:\n"
                "  POSTGRES_PASSWORD=<your-strong-password>"
            )

    # 输出警告
    for w in warnings:
        logger.warning("⚠️  %s", w)

    # 有错误则拒绝启动
    if errors:
        msg = "启动安全校验失败:\n" + "\n".join(f"  ❌ {e}" for e in errors)
        raise RuntimeError(msg)
