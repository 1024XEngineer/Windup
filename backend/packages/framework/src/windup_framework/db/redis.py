"""按需创建 Redis 客户端；默认配置不会打开 Redis 连接。"""

import redis

from windup_framework.config.redis import settings as redis_settings


from windup_framework.config.redis import RedisSettings


def create_redis_client(settings: RedisSettings) -> redis.Redis | None:
    """仅在显式启用时创建客户端；redis-py 会在首次命令时建立连接。"""

    if not settings.enabled:
        return None
    return redis.Redis.from_url(settings.url, decode_responses=True)


_client = create_redis_client(redis_settings)


def get_redis() -> redis.Redis | None:
    """返回可选 Redis 客户端；默认关闭时返回 ``None``。"""

    return _client
