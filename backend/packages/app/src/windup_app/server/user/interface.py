"""用户领域服务抽象接口。

API 层只依赖本模块定义的抽象，不感知具体实现（ORM / Redis / Resend）。

约定为 session-per-call：需要落库的方法由调用方传入 ``session``（FastAPI 的
``get_session`` 依赖），实现保持无状态，可作为模块级单例。
"""

from abc import ABC, abstractmethod

from sqlalchemy.orm import Session

from windup_app.server.user.model import (
    ChangePasswordInput,
    LoginByCodeInput,
    LoginByPasswordInput,
    LoginResult,
    RegisterInput,
    UserView,
)


class UserService(ABC):
    """用户用例的稳定边界。"""

    # -- 注册 ------------------------------------------------------------

    @abstractmethod
    def register_by_email(self, session: Session, input: RegisterInput) -> LoginResult:
        """邮箱+密码注册，注册成功即登录。

        :raises windup_common.exceptions.BizException: 邮箱已注册。
        """

    # -- 登录 ------------------------------------------------------------

    @abstractmethod
    def login_by_password(
        self, session: Session, input: LoginByPasswordInput
    ) -> LoginResult:
        """邮箱+密码登录。

        :raises windup_common.exceptions.BizException: 邮箱不存在 / 密码错误 / 账号已封禁。
        """

    @abstractmethod
    def send_verification_code(self, email: str, purpose: str) -> None:
        """发送邮箱验证码。

        :param purpose: 用途，如 "login" / "register" / "reset_password"。
        :raises windup_common.exceptions.BizException: 发送频率超限。
        """

    @abstractmethod
    def login_by_code(self, session: Session, input: LoginByCodeInput) -> LoginResult:
        """邮箱+验证码登录。内测期间不自动建号。

        :raises windup_common.exceptions.BizException: 验证码错误 / 已过期 / 账号不存在 / 账号已封禁。
        """

    # -- 登出 ------------------------------------------------------------

    @abstractmethod
    def logout(self, refresh_token: str) -> None:
        """销毁 refresh_token。"""

    # -- 会话管理 ---------------------------------------------------------

    @abstractmethod
    def validate_access_token(self, token: str) -> UserView | None:
        """校验 access_token 并返回用户，过期 / 无效返回 ``None``。"""

    @abstractmethod
    def refresh_tokens(self, refresh_token: str) -> LoginResult:
        """刷新 token，返回新的 access+refresh。

        :raises windup_common.exceptions.BizException: refresh token 无效 / 已撤销。
        """

    # -- 密码 ------------------------------------------------------------

    @abstractmethod
    def change_password(
        self, session: Session, user_id: int, input: ChangePasswordInput
    ) -> None:
        """修改密码（需验证旧密码）。

        :raises windup_common.exceptions.BizException: 旧密码错误。
        """

    # -- 查询 ------------------------------------------------------------

    @abstractmethod
    def get_by_id(self, session: Session, user_id: int) -> UserView | None:
        """按 ID 查询用户。"""

    @abstractmethod
    def get_by_email(self, session: Session, email: str) -> UserView | None:
        """按邮箱查询用户。"""
