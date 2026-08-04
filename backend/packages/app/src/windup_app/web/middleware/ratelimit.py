"""接口限流中间件。

基于 Redis 的滑动窗口计数器，在鉴权中间件之前执行。
Redis 不可用时优雅降级（跳过限流）。
"""

import logging

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

from windup_common.enums.biz_code import BizCode
from windup_common.exceptions import BizException

logger = logging.getLogger("windup.ratelimit")

# -- 限流配置 ------------------------------------------------------------

# 全局 API 限流：单 IP 60 次/分钟
GLOBAL_RATE = 60
GLOBAL_WINDOW = 60

# 敏感接口限流：单 IP 10 次/分钟
SENSITIVE_RATE = 10
SENSITIVE_WINDOW = 60

# 用户级限流：120 次/分钟
USER_RATE = 120
USER_WINDOW = 60

# 敏感接口路径
SENSITIVE_PATHS: set[str] = {
    "/auth/register",
    "/auth/login",
    "/auth/send-code",
    "/auth/login-by-code",
}

# -- Redis key 模板 ------------------------------------------------------

RATELIMIT_API_KEY = "ratelimit:api:{ip}"
RATELIMIT_SENSITIVE_KEY = "ratelimit:sensitive:{ip}"
RATELIMIT_USER_KEY = "ratelimit:api:{user_id}"


def _get_client_ip(request: Request) -> str:
    """获取客户端 IP（优先 X-Forwarded-For）。"""
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def _check_rate(redis_client, key: str, limit: int, window: int) -> bool:
    """检查是否超出限流，返回 True 表示允许通过。"""
    try:
        current = redis_client.incr(key)
        if current == 1:
            redis_client.expire(key, window)
        return current <= limit
    except Exception:
        # Redis 不可用时跳过限流
        logger.warning("[WINDUP] Redis 不可用，跳过限流检查 | key=%s", key)
        return True


class RateLimitMiddleware(BaseHTTPMiddleware):
    """接口限流中间件。"""

    def __init__(self, app) -> None:
        super().__init__(app)
        self._redis = None
        self._redis_available = True

    @property
    def redis(self):
        if self._redis is None:
            try:
                from windup_framework.db.redis import get_redis
                self._redis = get_redis()
                # 测试连接
                self._redis.ping()
            except Exception:
                self._redis_available = False
                logger.warning("[WINDUP] Redis 连接失败，限流中间件将跳过限流检查")
                return None
        return self._redis

    async def dispatch(self, request: Request, call_next) -> Response:
        # Redis 不可用时直接放行
        if not self._redis_available or self.redis is None:
            return await call_next(request)

        client_ip = _get_client_ip(request)

        # 全局限流
        if not _check_rate(self.redis, RATELIMIT_API_KEY.format(ip=client_ip), GLOBAL_RATE, GLOBAL_WINDOW):
            logger.warning("[WINDUP] 全局限流触发 | ip=%s path=%s", client_ip, request.url.path)
            raise BizException("请求过于频繁", code=BizCode.TOO_MANY_REQUESTS)

        # 敏感接口额外限流
        if request.url.path in SENSITIVE_PATHS:
            if not _check_rate(self.redis, RATELIMIT_SENSITIVE_KEY.format(ip=client_ip), SENSITIVE_RATE, SENSITIVE_WINDOW):
                logger.warning("[WINDUP] 敏感接口限流触发 | ip=%s path=%s", client_ip, request.url.path)
                raise BizException("请求过于频繁，请稍后再试", code=BizCode.TOO_MANY_REQUESTS)

        # 用户级限流（已登录用户）
        user_id = getattr(getattr(request.state, "current_user", None), "id", None)
        if user_id is not None:
            if not _check_rate(self.redis, RATELIMIT_USER_KEY.format(user_id=user_id), USER_RATE, USER_WINDOW):
                logger.warning("[WINDUP] 用户限流触发 | user_id=%s", user_id)
                raise BizException("请求过于频繁", code=BizCode.TOO_MANY_REQUESTS)

        return await call_next(request)
