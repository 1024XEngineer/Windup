"""两阶段限流中间件。

Phase 1 — AuthRateLimitMiddleware（IP 级，鉴权前执行）:
  - 认证端点各自独立 IP 桶，互不干扰
  - /auth/login 仅计失败（成功不消耗额度），由路由层调用 record_auth_failure
  - 非认证端点全局 IP 桶仅对匿名请求生效

Phase 2 — rate_limit_dep（用户级，鉴权后执行）:
  - 已登录请求按 user_id 计数
  - 匿名请求按 IP 计数
  - 作为 FastAPI dependency 注入到需要限流的路由

Redis 不可用时优雅降级（跳过限流）。
"""

import logging

from fastapi import Request
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response

from windup_common.enums.biz_code import BizCode
from windup_common.exceptions import BizException
from windup_common.result import Response as Resp

logger = logging.getLogger("windup.ratelimit")

# -- 限流配置 ------------------------------------------------------------

# 全局 API 限流：单 IP 60 次/分钟（仅匿名非认证请求）
GLOBAL_RATE = 60
GLOBAL_WINDOW = 60

# 已登录用户限流：120 次/分钟
USER_RATE = 120
USER_WINDOW = 60

# 匿名请求限流：30 次/分钟（Phase 2）
ANON_RATE = 30
ANON_WINDOW = 60

# 登录失败 IP 限流：10 次/分钟
LOGIN_FAIL_RATE = 10
LOGIN_FAIL_WINDOW = 60

# 认证端点 IP 限流配置：{path: (endpoint_name, limit)}
AUTH_ENDPOINT_LIMITS: dict[str, tuple[str, int]] = {
    "/auth/register": ("register", 3),
    "/auth/send-code": ("send-code", 3),
    "/auth/login-by-code": ("login-by-code", 5),
    "/auth/reset-password": ("reset-password", 3),
}

# -- Redis key 模板 ------------------------------------------------------

RATELIMIT_API_KEY = "ratelimit:api:{ip}"
RATELIMIT_AUTH_KEY = "ratelimit:auth:{endpoint}:{ip}"
RATELIMIT_USER_KEY = "ratelimit:user:{user_id}"
RATELIMIT_ANON_KEY = "ratelimit:anon:{ip}"


# 可信代理列表：只有这些来源的请求才信任 X-Forwarded-For
TRUSTED_PROXIES: set[str] = {"127.0.0.1", "::1", "172.16.0.0/12"}


def _is_trusted_proxy(host: str | None) -> bool:
    """判断请求来源是否在可信代理列表中。"""
    if not host:
        return False
    if host in TRUSTED_PROXIES:
        return True
    # Docker 网段 172.16.0.0/12
    try:
        parts = host.split(".")
        if len(parts) == 4 and parts[0] == "172" and 16 <= int(parts[1]) <= 31:
            return True
    except (ValueError, IndexError):
        pass
    return False


def _get_client_ip(request: Request) -> str:
    """获取客户端 IP，仅在可信代理后才信任 X-Forwarded-For。"""
    client_host = request.client.host if request.client else None
    if _is_trusted_proxy(client_host):
        forwarded = request.headers.get("x-forwarded-for")
        if forwarded:
            return forwarded.split(",")[0].strip()
    return client_host or "unknown"


def _has_auth_header(request: Request) -> bool:
    """判断请求是否携带 Authorization Bearer header。"""
    auth = request.headers.get("authorization", "")
    return auth.startswith("Bearer ")


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


def _check_login_failures(redis_client, key: str) -> bool:
    """读取登录失败计数，返回 True 表示允许通过（不递增计数）。"""
    try:
        current = redis_client.get(key)
        if current is None:
            return True
        return int(current) < LOGIN_FAIL_RATE
    except Exception:
        logger.warning("[WINDUP] Redis 不可用，跳过限流检查 | key=%s", key)
        return True


def _too_many_requests_response(msg: str = "请求过于频繁") -> JSONResponse:
    """构造限流拒绝响应。"""
    return JSONResponse(
        status_code=200,
        content=Resp.fail(msg, code=BizCode.TOO_MANY_REQUESTS).model_dump(mode="json"),
    )


# -- 共享 Redis 实例（middleware 和 dependency 共用） --------------------

_redis_client = None
_redis_available = True


def _get_redis():
    """获取 Redis 客户端，连接失败时返回 None。"""
    global _redis_client, _redis_available
    if _redis_client is None:
        if not _redis_available:
            return None
        try:
            from windup_framework.db.redis import get_redis
            _redis_client = get_redis()
            _redis_client.ping()
        except Exception:
            _redis_available = False
            logger.warning("[WINDUP] Redis 连接失败，限流功能将跳过")
            return None
    return _redis_client


def _reset_redis_state():
    """重置 Redis 状态（仅用于测试）。"""
    global _redis_client, _redis_available
    _redis_client = None
    _redis_available = True


# -- Phase 1: AuthRateLimitMiddleware（IP 级中间件）-----------------------


class AuthRateLimitMiddleware(BaseHTTPMiddleware):
    """Phase 1：认证端点 IP 级限流中间件（鉴权前执行）。

    - 认证端点各自独立 IP 桶
    - /auth/login 中间件不写入桶（由路由层失败时写入），但会读取已有计数做拦截
    - 非认证端点全局 IP 桶仅对匿名请求生效
    """

    async def dispatch(self, request: Request, call_next) -> Response:
        redis = _get_redis()
        if redis is None:
            return await call_next(request)

        path = request.url.path
        client_ip = _get_client_ip(request)

        # 认证端点：per-endpoint IP 桶
        if path in AUTH_ENDPOINT_LIMITS:
            endpoint, limit = AUTH_ENDPOINT_LIMITS[path]
            key = RATELIMIT_AUTH_KEY.format(endpoint=endpoint, ip=client_ip)
            if not _check_rate(redis, key, limit, 60):
                logger.warning(
                    "[WINDUP] 认证限流触发 | type=auth_endpoint endpoint=%s ip=%s",
                    endpoint, client_ip,
                )
                return _too_many_requests_response("请求过于频繁，请稍后再试")

        # /auth/login：中间件不写入桶（失败时由路由层 record_auth_failure 写入），
        # 但读取已有失败计数，超过上限时拦截后续请求。
        elif path == "/auth/login":
            key = RATELIMIT_AUTH_KEY.format(endpoint="login", ip=client_ip)
            if not _check_login_failures(redis, key):
                logger.warning(
                    "[WINDUP] 认证限流触发 | type=auth_login_failures ip=%s",
                    client_ip,
                )
                return _too_many_requests_response("请求过于频繁，请稍后再试")

        # 非认证端点：全局 IP 桶仅对匿名请求生效
        else:
            if not _has_auth_header(request):
                key = RATELIMIT_API_KEY.format(ip=client_ip)
                if not _check_rate(redis, key, GLOBAL_RATE, GLOBAL_WINDOW):
                    logger.warning(
                        "[WINDUP] 全局限流触发 | type=global_anon ip=%s path=%s",
                        client_ip, path,
                    )
                    return _too_many_requests_response()

        return await call_next(request)


# -- Phase 2: rate_limit_dep（用户级依赖）--------------------------------


async def rate_limit_dep(request: Request) -> None:
    """Phase 2：用户级限流（鉴权后执行，作为 FastAPI dependency）。

    已登录请求按 user_id 计数，匿名请求按 IP 计数。
    """
    redis = _get_redis()
    if redis is None:
        return

    user = getattr(request.state, "current_user", None)
    if user is not None:
        key = RATELIMIT_USER_KEY.format(user_id=user.id)
        limit = USER_RATE
        log_type = "authenticated"
    else:
        key = RATELIMIT_ANON_KEY.format(ip=_get_client_ip(request))
        limit = ANON_RATE
        log_type = "anonymous"

    if not _check_rate(redis, key, limit, 60):
        logger.warning("[WINDUP] 限流触发 | type=%s", log_type)
        raise BizException("请求过于频繁", code=BizCode.TOO_MANY_REQUESTS)


# -- 辅助：登录失败计数 ---------------------------------------------------


def record_auth_failure(endpoint: str, ip: str) -> None:
    """记录一次认证失败，用于 IP 级登录失败限流。

    仅在 /auth/login 失败时由路由层调用。
    """
    redis = _get_redis()
    if redis is None:
        return
    key = RATELIMIT_AUTH_KEY.format(endpoint=endpoint, ip=ip)
    _check_rate(redis, key, LOGIN_FAIL_RATE, LOGIN_FAIL_WINDOW)
