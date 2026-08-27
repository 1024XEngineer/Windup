"""首个独立管理员初始化命令的测试。"""

import pytest
from sqlalchemy import select

from windup_app.server.admin.bootstrap import create_admin
from windup_app.server.admin.model import AdminPermission, AdminRole, AdminUser
from windup_app.server.admin.permissions import ALL_ADMIN_PERMISSIONS
from windup_app.server.admin.service import verify_admin_password


def test_create_admin_seeds_super_admin_with_all_permissions(db_session):
    admin = create_admin(
        db_session,
        email="  Owner@Windup.Xin ",
        password="strong-password-2026",
    )
    db_session.commit()

    stored = db_session.scalar(select(AdminUser).where(AdminUser.id == admin.id))
    role = db_session.scalar(select(AdminRole).where(AdminRole.code == "super_admin"))
    permission_codes = set(db_session.scalars(select(AdminPermission.code)).all())

    assert stored is not None
    assert stored.email == "owner@windup.xin"
    assert verify_admin_password("strong-password-2026", stored.password_hash)
    assert role is not None
    assert role in stored.roles
    assert {permission.code for permission in role.permissions} == set(
        ALL_ADMIN_PERMISSIONS
    )
    assert permission_codes == set(ALL_ADMIN_PERMISSIONS)


def test_create_admin_rejects_duplicate_email_without_changing_existing(db_session):
    first = create_admin(
        db_session,
        email="owner@windup.xin",
        password="strong-password-2026",
    )
    db_session.commit()
    original_hash = first.password_hash

    with pytest.raises(ValueError, match="管理员邮箱已存在"):
        create_admin(
            db_session,
            email="OWNER@WINDUP.XIN",
            password="another-password-2026",
        )

    db_session.expire_all()
    stored = db_session.scalar(
        select(AdminUser).where(AdminUser.email == "owner@windup.xin")
    )
    assert stored is not None
    assert stored.password_hash == original_hash
    assert len(stored.roles) == 1


@pytest.mark.parametrize("password", ["too-short", "x" * 129])
def test_create_admin_rejects_password_outside_supported_length(db_session, password):
    with pytest.raises(ValueError, match="密码长度必须为 12 到 128 个字符"):
        create_admin(db_session, email="owner@windup.xin", password=password)
