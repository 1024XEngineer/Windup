from sqlalchemy import select

from windup_app.server.admin.audit import AdminAuditLog, record_admin_audit
from windup_app.server.admin.model import (
    AdminPermission,
    AdminRefreshToken,
    AdminRole,
    AdminStatus,
    AdminUser,
)
from windup_app.server.admin.permissions import (
    ADMIN_MANAGE,
    ALL_ADMIN_PERMISSIONS,
    AUDIT_READ,
)
from windup_app.server.user.model import User


def test_admin_identity_is_separate_from_normal_user(db_session):
    """普通用户与管理员可以同邮箱存在，证明两套身份没有复用同一张表。"""
    email = "owner@example.com"
    user = User(email=email, password_hash="normal-user-password-hash")
    admin = AdminUser(email=email, password_hash="admin-password-hash")
    db_session.add_all([user, admin])
    db_session.flush()

    assert user.id is not None
    assert admin.id is not None
    assert db_session.scalar(select(User).where(User.email == email)) is user
    assert db_session.scalar(select(AdminUser).where(AdminUser.email == email)) is admin


def test_admin_role_resolves_explicit_permissions(db_session):
    """角色权限必须来自关联表，不能因为角色名称而隐式获得全部权限。"""
    audit_permission = AdminPermission(code=AUDIT_READ, name="查看审计")
    role = AdminRole(code="auditor", name="审计员", permissions=[audit_permission])
    admin = AdminUser(
        email="auditor@example.com",
        password_hash="admin-password-hash",
        status=AdminStatus.ACTIVE,
        roles=[role],
    )
    db_session.add(admin)
    db_session.flush()

    assert {permission.code for permission in admin.roles[0].permissions} == {AUDIT_READ}
    assert ADMIN_MANAGE not in {permission.code for permission in admin.roles[0].permissions}
    assert AUDIT_READ in ALL_ADMIN_PERMISSIONS


def test_admin_refresh_token_persists_hash_only(db_session):
    """刷新令牌表保存固定长度摘要，不提供明文字段。"""
    admin = AdminUser(email="token@example.com", password_hash="admin-password-hash")
    db_session.add(admin)
    db_session.flush()
    token = AdminRefreshToken(
        admin_user_id=admin.id,
        token_hash="a" * 64,
        expires_at=admin.create_at,
    )
    db_session.add(token)
    db_session.flush()

    row = db_session.scalar(select(AdminRefreshToken))
    assert row is not None
    assert row.token_hash == "a" * 64
    assert "token" not in row.__table__.columns


def test_admin_audit_redacts_secret_fields(db_session):
    """即使调用方误传密码或令牌，审计详情也必须在落库前脱敏。"""
    row = record_admin_audit(
        db_session,
        admin_user_id=None,
        actor_email="owner@example.com",
        action="auth.login",
        resource_type="admin_user",
        resource_id=None,
        result="denied",
        after_summary={
            "status": "denied",
            "password": "plain-password",
            "access_token": "plain-token",
        },
    )
    db_session.flush()

    persisted = db_session.get(AdminAuditLog, row.id)
    assert persisted is not None
    assert persisted.after_summary == {
        "status": "denied",
        "password": "[REDACTED]",
        "access_token": "[REDACTED]",
    }
