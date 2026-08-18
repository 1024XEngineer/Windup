"""用户领域模型。

与 ``windup_user`` 表一一对应，字段名与数据库列名保持一致。

ORM 模型
--------

::

    windup_user
    ├── id                BigInteger PK: 自增主键
    ├── email             String(255) UNIQUE: 邮箱
    ├── password_hash     String(255): bcrypt 哈希
    ├── nickname           String(50) NULL: 昵称
    ├── email_verified_at DateTime(tz) NULL: 邮箱验证时间
    ├── status            SmallInteger: 0=正常, 1=封禁
    ├── last_login_at     DateTime(tz) NULL: 最后登录
    ├── create_at         DateTime(tz): 创建时间
    └── update_at         DateTime(tz): 更新时间
"""

from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import IntEnum

from sqlalchemy import BigInteger, DateTime, Integer, SmallInteger, String
from sqlalchemy.orm import Mapped, mapped_column

from windup_framework.db import Base


# -- ORM ----------------------------------------------------------------


class User(Base):
    """用户表。"""

    __tablename__ = "windup_user"

    id: Mapped[int] = mapped_column(
        BigInteger().with_variant(Integer, "sqlite"),
        primary_key=True,
        autoincrement=True,
    )
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    nickname: Mapped[str | None] = mapped_column(String(50), nullable=True)
    email_verified_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    status: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=0)
    last_login_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    create_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )
    update_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )


# -- 枚举 ----------------------------------------------------------------


class UserStatus(IntEnum):
    """用户状态。

    与 ``windup_user.status`` 列对齐：
    ``SMALLINT DEFAULT 0``，0=正常，1=封禁。
    """

    NORMAL = 0
    BANNED = 1


# -- 领域模型 ------------------------------------------------------------


@dataclass
class UserView:
    """用户视图（脱敏，不含 password_hash）。"""

    id: int | None = None
    email: str | None = None
    nickname: str | None = None
    email_verified_at: datetime | None = None
    status: UserStatus = UserStatus.NORMAL
    last_login_at: datetime | None = None
    create_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    update_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))

    @property
    def is_banned(self) -> bool:
        return self.status == UserStatus.BANNED

    @property
    def is_email_verified(self) -> bool:
        return self.email_verified_at is not None


# -- 输入/输出模型 --------------------------------------------------------


@dataclass
class RegisterInput:
    """邮箱注册入参。"""

    email: str
    password: str
    code: str
    nickname: str | None = None
    invite_code: str | None = None


@dataclass
class LoginByPasswordInput:
    """邮箱+密码登录入参。"""

    email: str
    password: str


@dataclass
class LoginByCodeInput:
    """邮箱+验证码登录入参。"""

    email: str
    code: str


@dataclass
class ChangePasswordInput:
    """修改密码入参。"""

    old_password: str
    new_password: str


@dataclass
class UpdateNicknameInput:
    """修改昵称入参。"""

    nickname: str


@dataclass
class ResetPasswordInput:
    """重置密码入参。"""

    email: str
    code: str
    new_password: str


@dataclass
class LoginResult:
    """登录结果。"""

    user: UserView
    access_token: str
    refresh_token: str
