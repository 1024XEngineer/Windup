"""交互式创建 Windup 独立管理平台管理员。"""

from __future__ import annotations

import argparse
import getpass

from windup_app.server.admin.audit import AdminAuditLog
from windup_app.server.admin.bootstrap import create_admin
from windup_app.server.admin.model import (
    AdminPermission,
    AdminRefreshToken,
    AdminRole,
    AdminUser,
    admin_role_permission,
    admin_user_role,
)
from windup_framework.db import Base, SessionLocal, engine

ADMIN_TABLES = [
    AdminPermission.__table__,
    AdminRole.__table__,
    AdminUser.__table__,
    admin_role_permission,
    admin_user_role,
    AdminRefreshToken.__table__,
    AdminAuditLog.__table__,
]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--email", required=True, help="管理员登录邮箱")
    args = parser.parse_args()

    password = getpass.getpass("管理员密码（12-128 个字符）: ")
    confirmation = getpass.getpass("再次输入管理员密码: ")
    if password != confirmation:
        parser.error("两次输入的密码不一致")

    Base.metadata.create_all(engine, tables=ADMIN_TABLES)
    with SessionLocal.begin() as session:
        admin = create_admin(session, email=args.email, password=password)

    print(f"已创建独立管理员：{admin.email}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
