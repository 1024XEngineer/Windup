"""Redis 客户端单例。

模块级 import 时创建连接池,调用方通过 ``get_redis`` 获取连接。
"""

import redis

from windup_framework.config.redis import settings as redis_settings

_pool = redis.ConnectionPool.from_url(redis_settings.url, decode_responses=True)


def get_redis() -> redis.Redis:
    """获取 Redis 连接(从连接池)。"""
    return redis.Redis(connection_pool=_pool)
