"""管理员 Cookie、CSRF 与权限依赖。"""

import secrets
from collections.abc import Callable

from fastapi import Depends, Request
from sqlalchemy.orm import Session

from windup_app.server.admin.service import AdminView, service
from windup_common.enums.biz_code import BizCode
from windup_common.exceptions import BizException
from windup_framework.db import get_session

ADMIN_ACCESS_COOKIE = "windup_admin_access"
ADMIN_REFRESH_COOKIE = "windup_admin_refresh"
ADMIN_CSRF_COOKIE = "windup_admin_csrf"


def require_admin_user(
    request: Request,
    session: Session = Depends(get_session),
) -> AdminView:
    token = request.cookies.get(ADMIN_ACCESS_COOKIE, "")
    if not token:
        raise BizException("管理员未登录", code=BizCode.UNAUTHORIZED)
    payload = service.decode_access_token(token)
    return service.load_active_admin(session, int(payload["sub"]))


def require_admin_csrf(request: Request) -> None:
    cookie_value = request.cookies.get(ADMIN_CSRF_COOKIE, "")
    header_value = request.headers.get("x-csrf-token", "")
    if (
        not cookie_value
        or not header_value
        or not secrets.compare_digest(cookie_value, header_value)
    ):
        raise BizException("CSRF 校验失败", code=403)


def require_admin_permissions(*codes: str) -> Callable[..., AdminView]:
    def dependency(admin: AdminView = Depends(require_admin_user)) -> AdminView:
        service.require_permissions(admin, codes)
        return admin

    return dependency
