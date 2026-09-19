"""JWT 鉴权中间件。

统一拦截请求，白名单路径放行，其余路径验证 JWT access_token。
验证通过后将用户信息注入 ``request.state.current_user``。
"""

from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response
from starlette.concurrency import run_in_threadpool

from windup_common.enums.biz_code import BizCode
from windup_common.exceptions import BizException
from windup_common.result import Response as Resp

from windup_app.server.user.service import decode_token, service
from windup_framework.db import SessionLocal


def _validate_access_token(session_factory, token: str):
    """在线程池中使用独立会话校验 token 与账号版本。"""
    with session_factory() as session:
        return service.validate_access_token(session, token)


def _biz_error(msg: str, code: int) -> JSONResponse:
    """BizException → JSONResponse，用于 middleware 层（绕过 ExceptionMiddleware）。"""
    return JSONResponse(
        status_code=200,
        content=Resp.fail(msg, code=code).model_dump(mode="json"),
    )


def _auth_error(request: Request, msg: str, code: int) -> JSONResponse:
    """The OpenAI-compatible endpoint needs a real 401 for SDK error handling."""
    if request.url.path == "/ai/chat":
        return JSONResponse(
            status_code=401,
            content={
                "error": {
                    "message": msg,
                    "type": "authentication_error",
                    "code": "authentication_error",
                }
            },
        )
    return _biz_error(msg, code)


# -- 白名单路径（不需要鉴权）---------------------------------------------

AUTH_WHITELIST: set[str] = {
    "/auth/register",
    "/auth/login",
    "/auth/send-code",
    "/auth/login-by-code",
    "/auth/reset-password",
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
            return _auth_error(request, "未登录", BizCode.UNAUTHORIZED)

        token = auth_header[7:]  # 去掉 "Bearer " 前缀

        # 先保留既有的明确错误信息，再校验账号会话版本。
        try:
            payload = decode_token(token)
        except BizException as exc:
            return _auth_error(request, exc.message, exc.code)
        if payload.get("type") != "access":
            return _auth_error(request, "token 类型错误", BizCode.UNAUTHORIZED)

        session_factory = getattr(
            request.app.state, "auth_session_factory", SessionLocal
        )
        current_user = await run_in_threadpool(
            _validate_access_token, session_factory, token
        )
        if current_user is None:
            return _auth_error(request, "token 无效或已失效", BizCode.UNAUTHORIZED)

        # 注入当前用户到 request.state
        request.state.current_user = type(
            "CurrentUser",
            (),
            {"id": current_user.id, "email": current_user.email or ""},
        )()

        return await call_next(request)
