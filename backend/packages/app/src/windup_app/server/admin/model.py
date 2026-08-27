"""独立管理员身份、RBAC 与刷新令牌 ORM 模型。"""

from datetime import datetime, timezone
from enum import IntEnum

from sqlalchemy import (
    BigInteger,
    Boolean,
    Column,
    DateTime,
    ForeignKey,
    Integer,
    SmallInteger,
    String,
    Table,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from windup_framework.db import Base


def _bigint_type():
    return BigInteger().with_variant(Integer, "sqlite")


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class AdminStatus(IntEnum):
    ACTIVE = 0
    DISABLED = 1


admin_user_role = Table(
    "windup_admin_user_role",
    Base.metadata,
    Column(
        "admin_user_id",
        _bigint_type(),
        ForeignKey("windup_admin_user.id", ondelete="CASCADE"),
        primary_key=True,
    ),
    Column(
        "role_id",
        _bigint_type(),
        ForeignKey("windup_admin_role.id", ondelete="CASCADE"),
        primary_key=True,
    ),
    Column("create_at", DateTime(timezone=True), nullable=False, default=_utcnow),
)


admin_role_permission = Table(
    "windup_admin_role_permission",
    Base.metadata,
    Column(
        "role_id",
        _bigint_type(),
        ForeignKey("windup_admin_role.id", ondelete="CASCADE"),
        primary_key=True,
    ),
    Column(
        "permission_id",
        _bigint_type(),
        ForeignKey("windup_admin_permission.id", ondelete="CASCADE"),
        primary_key=True,
    ),
    Column("create_at", DateTime(timezone=True), nullable=False, default=_utcnow),
)


class AdminUser(Base):
    __tablename__ = "windup_admin_user"

    id: Mapped[int] = mapped_column(_bigint_type(), primary_key=True, autoincrement=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    status: Mapped[int] = mapped_column(
        SmallInteger,
        nullable=False,
        default=int(AdminStatus.ACTIVE),
    )
    force_password_change: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    create_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utcnow
    )
    update_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utcnow, onupdate=_utcnow
    )

    roles: Mapped[list["AdminRole"]] = relationship(
        secondary=admin_user_role,
        back_populates="users",
        lazy="selectin",
    )


class AdminRole(Base):
    __tablename__ = "windup_admin_role"

    id: Mapped[int] = mapped_column(_bigint_type(), primary_key=True, autoincrement=True)
    code: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    create_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utcnow
    )
    update_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utcnow, onupdate=_utcnow
    )

    users: Mapped[list[AdminUser]] = relationship(
        secondary=admin_user_role,
        back_populates="roles",
    )
    permissions: Mapped[list["AdminPermission"]] = relationship(
        secondary=admin_role_permission,
        back_populates="roles",
        lazy="selectin",
    )


class AdminPermission(Base):
    __tablename__ = "windup_admin_permission"

    id: Mapped[int] = mapped_column(_bigint_type(), primary_key=True, autoincrement=True)
    code: Mapped[str] = mapped_column(String(128), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    create_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utcnow
    )

    roles: Mapped[list[AdminRole]] = relationship(
        secondary=admin_role_permission,
        back_populates="permissions",
    )


class AdminRefreshToken(Base):
    __tablename__ = "windup_admin_refresh_token"

    id: Mapped[int] = mapped_column(_bigint_type(), primary_key=True, autoincrement=True)
    admin_user_id: Mapped[int] = mapped_column(
        _bigint_type(),
        ForeignKey("windup_admin_user.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    replaced_by_id: Mapped[int | None] = mapped_column(
        _bigint_type(),
        ForeignKey("windup_admin_refresh_token.id", ondelete="SET NULL"),
    )
    created_ip: Mapped[str | None] = mapped_column(String(64))
    create_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utcnow
    )

    admin_user: Mapped[AdminUser] = relationship(lazy="joined")
