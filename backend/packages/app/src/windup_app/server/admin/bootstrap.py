"""独立管理平台首个管理员的初始化服务。"""

from sqlalchemy import select
from sqlalchemy.orm import Session

from windup_app.server.admin.model import AdminPermission, AdminRole, AdminUser
from windup_app.server.admin.permissions import ALL_ADMIN_PERMISSIONS
from windup_app.server.admin.service import hash_admin_password

SUPER_ADMIN_ROLE_CODE = "super_admin"
SUPER_ADMIN_ROLE_NAME = "超级管理员"


def _normalize_email(email: str) -> str:
    normalized = email.strip().lower()
    if not normalized or "@" not in normalized:
        raise ValueError("请输入有效的管理员邮箱")
    return normalized


def _validate_password(password: str) -> None:
    if not 12 <= len(password) <= 128:
        raise ValueError("密码长度必须为 12 到 128 个字符")


def _seed_permissions(session: Session) -> list[AdminPermission]:
    existing = {
        permission.code: permission
        for permission in session.scalars(select(AdminPermission)).all()
    }
    permissions: list[AdminPermission] = []
    for code in sorted(ALL_ADMIN_PERMISSIONS):
        permission = existing.get(code)
        if permission is None:
            permission = AdminPermission(code=code, name=code)
            session.add(permission)
        permissions.append(permission)
    return permissions


def create_admin(session: Session, *, email: str, password: str) -> AdminUser:
    """创建一个具备全部权限的独立管理员，重复邮箱不会覆盖。"""

    normalized_email = _normalize_email(email)
    _validate_password(password)
    if session.scalar(select(AdminUser.id).where(AdminUser.email == normalized_email)):
        raise ValueError("管理员邮箱已存在")

    permissions = _seed_permissions(session)
    role = session.scalar(
        select(AdminRole).where(AdminRole.code == SUPER_ADMIN_ROLE_CODE)
    )
    if role is None:
        role = AdminRole(code=SUPER_ADMIN_ROLE_CODE, name=SUPER_ADMIN_ROLE_NAME)
        session.add(role)
    role.enabled = True
    role.permissions = permissions

    admin = AdminUser(
        email=normalized_email,
        password_hash=hash_admin_password(password),
        roles=[role],
    )
    session.add(admin)
    session.flush()
    return admin
