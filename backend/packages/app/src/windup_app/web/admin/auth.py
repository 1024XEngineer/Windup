"""管理员登录、刷新、登出与当前会话 API。"""

from fastapi import APIRouter, Depends, Request
from fastapi import Response as HttpResponse
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy.orm import Session

from windup_app.server.admin.audit import record_admin_audit
from windup_app.server.admin.service import AdminSession, AdminView, service
from windup_app.web.admin.dependencies import (
    ADMIN_ACCESS_COOKIE,
    ADMIN_CSRF_COOKIE,
    ADMIN_REFRESH_COOKIE,
    require_admin_csrf,
    require_admin_user,
)
from windup_common.enums.biz_code import BizCode
from windup_common.exceptions import BizException
from windup_common.result import Response
from windup_framework.config.admin_auth import settings as admin_auth_settings
from windup_framework.db import get_session

public_router = APIRouter(prefix="/auth", tags=["admin-auth"])
protected_router = APIRouter(prefix="/auth", tags=["admin-auth"])


class AdminLoginIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)


class AdminOut(BaseModel):
    id: int
    email: str
    permissions: list[str]


class AdminSessionOut(BaseModel):
    admin: AdminOut


def _admin_out(admin: AdminView) -> AdminOut:
    return AdminOut(
        id=admin.id,
        email=admin.email,
        permissions=sorted(admin.permissions),
    )


def _cookie_domain() -> str | None:
    return admin_auth_settings.cookie_domain or None


def _set_session_cookies(response: HttpResponse, admin_session: AdminSession) -> None:
    common = {
        "secure": admin_auth_settings.cookie_secure,
        "samesite": "strict",
        "domain": _cookie_domain(),
    }
    response.set_cookie(
        ADMIN_ACCESS_COOKIE,
        admin_session.access_token,
        max_age=admin_auth_settings.access_token_ttl_seconds,
        httponly=True,
        path="/admin-api",
        **common,
    )
    response.set_cookie(
        ADMIN_REFRESH_COOKIE,
        admin_session.refresh_token,
        max_age=admin_auth_settings.refresh_token_ttl_seconds,
        httponly=True,
        path="/admin-api/auth",
        **common,
    )
    response.set_cookie(
        ADMIN_CSRF_COOKIE,
        admin_session.csrf_token,
        max_age=admin_auth_settings.refresh_token_ttl_seconds,
        httponly=False,
        # 管理 SPA 位于站点根路径；该双提交值必须能被页面读取后放进请求头。
        path="/",
        **common,
    )


def _clear_session_cookies(response: HttpResponse) -> None:
    common = {
        "secure": admin_auth_settings.cookie_secure,
        "samesite": "strict",
        "domain": _cookie_domain(),
    }
    response.delete_cookie(
        ADMIN_ACCESS_COOKIE,
        httponly=True,
        path="/admin-api",
        **common,
    )
    response.delete_cookie(
        ADMIN_REFRESH_COOKIE,
        httponly=True,
        path="/admin-api/auth",
        **common,
    )
    response.delete_cookie(
        ADMIN_CSRF_COOKIE,
        httponly=False,
        path="/",
        **common,
    )


def _client_ip(request: Request) -> str | None:
    return request.client.host if request.client else None


def _audit_request_fields(request: Request) -> dict[str, str | None]:
    return {
        "request_id": request.headers.get("x-request-id"),
        "ip_address": _client_ip(request),
        "user_agent": request.headers.get("user-agent"),
    }


@public_router.post("/login", response_model=Response[AdminSessionOut])
def login(
    body: AdminLoginIn,
    request: Request,
    response: HttpResponse,
    session: Session = Depends(get_session),
) -> Response[AdminSessionOut]:
    admin_session = service.authenticate(
        session,
        email=str(body.email),
        password=body.password,
        ip_address=_client_ip(request),
    )
    _set_session_cookies(response, admin_session)
    record_admin_audit(
        session,
        admin_user_id=admin_session.admin.id,
        actor_email=admin_session.admin.email,
        action="auth.login",
        resource_type="admin_user",
        resource_id=str(admin_session.admin.id),
        result="success",
        after_summary={"status": "authenticated"},
        **_audit_request_fields(request),
    )
    return Response.success(AdminSessionOut(admin=_admin_out(admin_session.admin)))


@public_router.post(
    "/refresh",
    response_model=Response[AdminSessionOut],
    dependencies=[Depends(require_admin_csrf)],
)
def refresh(
    request: Request,
    response: HttpResponse,
    session: Session = Depends(get_session),
) -> Response[AdminSessionOut]:
    refresh_token = request.cookies.get(ADMIN_REFRESH_COOKIE, "")
    if not refresh_token:
        raise BizException("refresh token 无效", code=BizCode.UNAUTHORIZED)
    admin_session = service.refresh(
        session,
        refresh_token,
        ip_address=_client_ip(request),
    )
    _set_session_cookies(response, admin_session)
    return Response.success(AdminSessionOut(admin=_admin_out(admin_session.admin)))


@protected_router.get("/me", response_model=Response[AdminSessionOut])
def me(admin: AdminView = Depends(require_admin_user)) -> Response[AdminSessionOut]:
    return Response.success(AdminSessionOut(admin=_admin_out(admin)))


@protected_router.post(
    "/logout",
    response_model=Response[None],
    dependencies=[Depends(require_admin_csrf)],
)
def logout(
    request: Request,
    response: HttpResponse,
    session: Session = Depends(get_session),
    admin: AdminView = Depends(require_admin_user),
) -> Response[None]:
    refresh_token = request.cookies.get(ADMIN_REFRESH_COOKIE, "")
    if refresh_token:
        service.logout(session, refresh_token)
    _clear_session_cookies(response)
    record_admin_audit(
        session,
        admin_user_id=admin.id,
        actor_email=admin.email,
        action="auth.logout",
        resource_type="admin_user",
        resource_id=str(admin.id),
        result="success",
        after_summary={"status": "logged_out"},
        **_audit_request_fields(request),
    )
    return Response.success(None, message="已登出")
