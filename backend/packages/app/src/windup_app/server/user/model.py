"""用户领域模型。

与 ``windup_user`` / ``windup_user_oauth`` 表一一对应，
字段名与数据库列名保持一致，方便后续 ORM 映射。
"""

from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import IntEnum


# -- 枚举 ----------------------------------------------------------------

class UserStatus(IntEnum):
    """用户状态。

    与 ``windup_user.status`` 列对齐：
    ``SMALLINT DEFAULT 0``，0=正常，1=封禁。
    """

    NORMAL = 0
    BANNED = 1


class OAuthProvider(str):
    """第三方登录平台（值约束）。"""

    GITHUB = "github"
    GOOGLE = "google"


# -- 数据模型 ------------------------------------------------------------

@dataclass
class User:
    """用户（对应 ``windup_user`` 表）。"""

    id: int | None = None
    email: str | None = None
    password_hash: str = ""
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


@dataclass
class UserOAuth:
    """第三方登录绑定（对应 ``windup_user_oauth`` 表）。"""

    id: int | None = None
    user_id: int = 0
    provider: str = ""           # "github" / "google"
    provider_user_id: str = ""
    provider_email: str | None = None
    create_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    update_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))


# -- 输入/输出模型 --------------------------------------------------------

@dataclass
class RegisterInput:
    """邮箱注册入参。"""

    email: str
    password: str
    nickname: str | None = None


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
class OAuthCallbackInput:
    """OAuth 回调入参。"""

    provider: str          # "github" / "google"
    code: str
    state: str             # CSRF 防护


@dataclass
class ChangePasswordInput:
    """修改密码入参。"""

    old_password: str
    new_password: str


@dataclass
class LoginResult:
    """登录结果。

    ``session_token`` 由调用方通过 Set-Cookie 写入客户端；
    ``user`` 返回脱敏后的用户信息（不含 password_hash）。
    """

    user: User
    session_token: str