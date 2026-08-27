"""独立管理员认证、令牌轮换与权限服务。"""

import hashlib
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Iterable

import bcrypt
import jwt
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from windup_app.server.admin.model import (
    AdminRefreshToken,
    AdminRole,
    AdminStatus,
    AdminUser,
)
from windup_common.enums.biz_code import BizCode
from windup_common.exceptions import BizException
from windup_framework.config.admin_auth import settings as admin_auth_settings

ADMIN_JWT_ALGORITHM = "HS256"
ADMIN_JWT_ISSUER = "windup"
ADMIN_JWT_AUDIENCE = "windup-admin"


@dataclass(frozen=True)
class AdminView:
    id: int
    email: str
    permissions: frozenset[str]


@dataclass(frozen=True)
class AdminSession:
    admin: AdminView
    access_token: str
    refresh_token: str
    csrf_token: str


def hash_admin_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_admin_password(password: str, password_hash: str) -> bool:
    if not password_hash.startswith("$2"):
        return False
    try:
        return bcrypt.checkpw(password.encode(), password_hash.encode())
    except ValueError:
        return False


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _as_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


class AdminAuthService:
    def _admin_query(self):
        return select(AdminUser).options(
            selectinload(AdminUser.roles).selectinload(AdminRole.permissions)
        )

    @staticmethod
    def hash_refresh_token(token: str) -> str:
        return hashlib.sha256(token.encode()).hexdigest()

    def _to_view(self, admin: AdminUser) -> AdminView:
        permissions = {
            permission.code
            for role in admin.roles
            if role.enabled
            for permission in role.permissions
        }
        return AdminView(
            id=admin.id,
            email=admin.email,
            permissions=frozenset(permissions),
        )

    def load_active_admin(self, session: Session, admin_user_id: int) -> AdminView:
        admin = session.scalar(
            self._admin_query().where(AdminUser.id == admin_user_id)
        )
        if admin is None or admin.status != AdminStatus.ACTIVE:
            raise BizException("管理员会话无效", code=BizCode.UNAUTHORIZED)
        return self._to_view(admin)

    def _create_access_token(self, admin: AdminUser) -> str:
        now = _utcnow()
        payload = {
            "sub": str(admin.id),
            "email": admin.email,
            "type": "admin_access",
            "iss": ADMIN_JWT_ISSUER,
            "aud": ADMIN_JWT_AUDIENCE,
            "iat": now,
            "exp": now
            + timedelta(seconds=admin_auth_settings.access_token_ttl_seconds),
        }
        return jwt.encode(
            payload,
            admin_auth_settings.jwt_secret.get_secret_value(),
            algorithm=ADMIN_JWT_ALGORITHM,
        )

    def decode_access_token(self, token: str) -> dict[str, Any]:
        try:
            payload = jwt.decode(
                token,
                admin_auth_settings.jwt_secret.get_secret_value(),
                algorithms=[ADMIN_JWT_ALGORITHM],
                audience=ADMIN_JWT_AUDIENCE,
                issuer=ADMIN_JWT_ISSUER,
            )
        except jwt.PyJWTError:
            raise BizException(
                "管理员会话无效", code=BizCode.UNAUTHORIZED
            ) from None
        if payload.get("type") != "admin_access":
            raise BizException("管理员会话无效", code=BizCode.UNAUTHORIZED)
        try:
            int(payload["sub"])
        except (KeyError, TypeError, ValueError):
            raise BizException(
                "管理员会话无效", code=BizCode.UNAUTHORIZED
            ) from None
        return payload

    def _issue_session(
        self,
        session: Session,
        admin: AdminUser,
        *,
        ip_address: str | None,
    ) -> AdminSession:
        refresh_token = secrets.token_urlsafe(48)
        session.add(
            AdminRefreshToken(
                admin_user_id=admin.id,
                token_hash=self.hash_refresh_token(refresh_token),
                expires_at=_utcnow()
                + timedelta(seconds=admin_auth_settings.refresh_token_ttl_seconds),
                created_ip=ip_address,
            )
        )
        session.flush()
        return AdminSession(
            admin=self._to_view(admin),
            access_token=self._create_access_token(admin),
            refresh_token=refresh_token,
            csrf_token=secrets.token_urlsafe(48),
        )

    def authenticate(
        self,
        session: Session,
        *,
        email: str,
        password: str,
        ip_address: str | None,
    ) -> AdminSession:
        normalized_email = email.strip().lower()
        admin = session.scalar(
            self._admin_query().where(AdminUser.email == normalized_email)
        )
        if admin is None or not verify_admin_password(password, admin.password_hash):
            raise BizException("邮箱或密码错误", code=BizCode.UNAUTHORIZED)
        if admin.status != AdminStatus.ACTIVE:
            raise BizException("管理员账号已停用", code=403)
        admin.last_login_at = _utcnow()
        session.flush()
        return self._issue_session(session, admin, ip_address=ip_address)

    def refresh(
        self,
        session: Session,
        refresh_token: str,
        *,
        ip_address: str | None,
    ) -> AdminSession:
        token_hash = self.hash_refresh_token(refresh_token)
        row = session.scalar(
            select(AdminRefreshToken)
            .where(AdminRefreshToken.token_hash == token_hash)
            .with_for_update()
        )
        now = _utcnow()
        if (
            row is None
            or row.revoked_at is not None
            or _as_utc(row.expires_at) <= now
        ):
            raise BizException("refresh token 无效", code=BizCode.UNAUTHORIZED)

        admin = session.scalar(
            self._admin_query().where(AdminUser.id == row.admin_user_id)
        )
        if admin is None or admin.status != AdminStatus.ACTIVE:
            raise BizException("管理员会话无效", code=BizCode.UNAUTHORIZED)

        row.revoked_at = now
        replacement = self._issue_session(session, admin, ip_address=ip_address)
        replacement_row = session.scalar(
            select(AdminRefreshToken).where(
                AdminRefreshToken.token_hash
                == self.hash_refresh_token(replacement.refresh_token)
            )
        )
        if replacement_row is None:
            raise RuntimeError("管理员 refresh token 轮换落库失败")
        row.replaced_by_id = replacement_row.id
        session.flush()
        return replacement

    def logout(self, session: Session, refresh_token: str) -> None:
        row = session.scalar(
            select(AdminRefreshToken)
            .where(
                AdminRefreshToken.token_hash
                == self.hash_refresh_token(refresh_token)
            )
            .with_for_update()
        )
        if row is not None and row.revoked_at is None:
            row.revoked_at = _utcnow()
            session.flush()

    @staticmethod
    def require_permissions(admin: AdminView, required: Iterable[str]) -> None:
        if not set(required).issubset(admin.permissions):
            raise BizException("没有管理员权限", code=403)


service = AdminAuthService()
