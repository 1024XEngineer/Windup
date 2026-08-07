"""JWT 鉴权中间件。

统一拦截请求，白名单路径放行，其余路径验证 JWT access_token。
验证通过后将用户信息注入 ``request.state.current_user``。
"""

from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

from windup_common.enums.biz_code import BizCode
from windup_common.exceptions import BizException
from windup_common.result import Response as Resp

from windup_app.server.user.service import decode_token


def _biz_error(msg: str, code: int) -> JSONResponse:
    """BizException → JSONResponse，用于 middleware 层（绕过 ExceptionMiddleware）。"""
    return JSONResponse(
        status_code=200,
        content=Resp.fail(msg, code=code).model_dump(mode="json"),
    )

# -- 白名单路径（不需要鉴权）---------------------------------------------

AUTH_WHITELIST: set[str] = {
    "/auth/register",
    "/auth/login",
    "/auth/send-code",
    "/auth/login-by-code",
    "/auth/refresh",
    "/auth/logout",
    "/docs",
    "/openapi.json",
    "/health",
}

# 前缀白名单（如 /docs 子路径、Swagger 静态资源）
AUTH_WHITELIST_PREFIXES: tuple[str, ...] = (
    "/docs",
    "/redoc",
    "/openapi",
)


def _is_whitelisted(path: str) -> bool:
    """判断路径是否在白名单中。"""
    if path in AUTH_WHITELIST:
        return True
    return any(path.startswith(prefix) for prefix in AUTH_WHITELIST_PREFIXES)


class AuthMiddleware(BaseHTTPMiddleware):
    """JWT 鉴权中间件。"""

    async def dispatch(self, request: Request, call_next) -> Response:
        # 白名单放行
        if _is_whitelisted(request.url.path):
            return await call_next(request)

        # 提取 Authorization header
        auth_header = request.headers.get("authorization", "")
        if not auth_header.startswith("Bearer "):
            return _biz_error("未登录", BizCode.UNAUTHORIZED)

        token = auth_header[7:]  # 去掉 "Bearer " 前缀

        # 解码 + 验证
        try:
            payload = decode_token(token)
        except BizException as e:
            return _biz_error(e.message, e.code)

        if payload.get("type") != "access":
            return _biz_error("token 类型错误", BizCode.UNAUTHORIZED)

        # 注入当前用户到 request.state
        request.state.current_user = type(
            "CurrentUser", (), {"id": int(payload["sub"]), "email": payload.get("email", "")}
        )()

        return await call_next(request)
