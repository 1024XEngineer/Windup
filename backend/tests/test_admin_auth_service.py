from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from windup_app.server.admin.model import (
    AdminPermission,
    AdminRefreshToken,
    AdminRole,
    AdminStatus,
    AdminUser,
)
from windup_app.server.admin.permissions import ADMIN_MANAGE, AUDIT_READ
from windup_app.server.admin.service import (
    hash_admin_password,
    service,
)
from windup_app.server.user.service import create_access_token
from windup_common.exceptions import BizException


def _seed_admin(
    db_session,
    *,
    email: str = "owner@example.com",
    password: str = "correct-password",
    permissions: set[str] | None = None,
    status: AdminStatus = AdminStatus.ACTIVE,
) -> AdminUser:
    permission_rows = [
        AdminPermission(code=code, name=code) for code in sorted(permissions or {AUDIT_READ})
    ]
    role = AdminRole(code=f"role-{email}", name="测试角色", permissions=permission_rows)
    admin = AdminUser(
        email=email,
        password_hash=hash_admin_password(password),
        status=status,
        roles=[role],
    )
    db_session.add(admin)
    db_session.flush()
    return admin


def test_login_returns_isolated_admin_session_with_permissions(db_session):
    admin = _seed_admin(db_session, permissions={AUDIT_READ, ADMIN_MANAGE})

    result = service.authenticate(
        db_session,
        email=" OWNER@EXAMPLE.COM ",
        password="correct-password",
        ip_address="127.0.0.1",
    )

    assert result.admin.id == admin.id
    assert result.admin.email == "owner@example.com"
    assert result.admin.permissions == frozenset({AUDIT_READ, ADMIN_MANAGE})
    assert result.access_token
    assert result.refresh_token
    assert result.csrf_token
    row = db_session.scalar(select(AdminRefreshToken))
    assert row is not None
    assert row.token_hash != result.refresh_token
    assert len(row.token_hash) == 64
    assert row.created_ip == "127.0.0.1"


@pytest.mark.parametrize("email,password", [
    ("missing@example.com", "correct-password"),
    ("owner@example.com", "wrong-password"),
])
def test_login_rejects_unknown_or_wrong_credentials_with_same_message(
    db_session,
    email: str,
    password: str,
):
    _seed_admin(db_session)

    with pytest.raises(BizException, match="邮箱或密码错误"):
        service.authenticate(
            db_session,
            email=email,
            password=password,
            ip_address=None,
        )


def test_login_rejects_disabled_admin(db_session):
    _seed_admin(db_session, status=AdminStatus.DISABLED)

    with pytest.raises(BizException, match="管理员账号已停用"):
        service.authenticate(
            db_session,
            email="owner@example.com",
            password="correct-password",
            ip_address=None,
        )


def test_normal_user_access_token_is_not_admin_token():
    token = create_access_token(1, "user@example.com")

    with pytest.raises(BizException, match="管理员会话无效"):
        service.decode_access_token(token)


def test_refresh_rotates_and_rejects_reuse(db_session):
    _seed_admin(db_session)
    initial = service.authenticate(
        db_session,
        email="owner@example.com",
        password="correct-password",
        ip_address="127.0.0.1",
    )

    rotated = service.refresh(
        db_session,
        initial.refresh_token,
        ip_address="127.0.0.2",
    )

    assert rotated.refresh_token != initial.refresh_token
    rows = db_session.scalars(select(AdminRefreshToken).order_by(AdminRefreshToken.id)).all()
    assert len(rows) == 2
    assert rows[0].revoked_at is not None
    assert rows[0].replaced_by_id == rows[1].id
    assert rows[1].created_ip == "127.0.0.2"
    with pytest.raises(BizException, match="refresh token 无效"):
        service.refresh(db_session, initial.refresh_token, ip_address=None)


def test_refresh_rejects_expired_token(db_session):
    admin = _seed_admin(db_session)
    raw_token = "expired-refresh-token"
    db_session.add(
        AdminRefreshToken(
            admin_user_id=admin.id,
            token_hash=service.hash_refresh_token(raw_token),
            expires_at=datetime.now(timezone.utc) - timedelta(seconds=1),
        )
    )
    db_session.flush()

    with pytest.raises(BizException, match="refresh token 无效"):
        service.refresh(db_session, raw_token, ip_address=None)


def test_logout_revokes_refresh_token_and_is_idempotent(db_session):
    _seed_admin(db_session)
    session = service.authenticate(
        db_session,
        email="owner@example.com",
        password="correct-password",
        ip_address=None,
    )

    service.logout(db_session, session.refresh_token)
    service.logout(db_session, session.refresh_token)

    with pytest.raises(BizException, match="refresh token 无效"):
        service.refresh(db_session, session.refresh_token, ip_address=None)


def test_permission_check_rejects_missing_permission(db_session):
    _seed_admin(db_session, permissions={AUDIT_READ})
    session = service.authenticate(
        db_session,
        email="owner@example.com",
        password="correct-password",
        ip_address=None,
    )

    with pytest.raises(BizException, match="没有管理员权限"):
        service.require_permissions(session.admin, {ADMIN_MANAGE})
