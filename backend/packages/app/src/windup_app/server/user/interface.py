"""用户领域服务抽象接口。

API 层只依赖本模块定义的抽象，不感知具体实现（ORM / Redis / OAuth SDK）。
"""

from abc import ABC, abstractmethod

from windup_app.server.user.model import (
    ChangePasswordInput,
    LoginByCodeInput,
    LoginByPasswordInput,
    LoginResult,
    RegisterInput,
    User,
)


class UserService(ABC):
    """用户用例的稳定边界。"""

    # -- 注册 ------------------------------------------------------------

    @abstractmethod
    def register_by_email(self, input: RegisterInput) -> LoginResult:
        """邮箱+密码注册，注册成功即登录。

        :raises windup_common.exceptions.BizException: 邮箱已注册。
        """

    # -- 登录 ------------------------------------------------------------

    @abstractmethod
    def login_by_password(self, input: LoginByPasswordInput) -> LoginResult:
        """邮箱+密码登录。

        :raises windup_common.exceptions.BizException: 邮箱不存在 / 密码错误 / 账号已封禁。
        """

    @abstractmethod
    def send_verification_code(self, email: str) -> None:
        """发送邮箱验证码。

        :raises windup_common.exceptions.BizException: 发送频率超限。
        """

    @abstractmethod
    def login_by_code(self, input: LoginByCodeInput) -> LoginResult:
        """邮箱+验证码登录，无账号时自动注册。

        :raises windup_common.exceptions.BizException: 验证码错误 / 已过期 / 账号已封禁。
        """

    # -- 登出 ------------------------------------------------------------

    @abstractmethod
    def logout(self, session_token: str) -> None:
        """销毁会话。"""

    # -- OAuth -----------------------------------------------------------
    # 第三方认证暂不设计、不实现。保留该区域作为后续扩展占位。
    # 相关 authorize / callback / bind 接口和 UserOAuth 模型暂时停用。
    # -- 会话管理 ---------------------------------------------------------

    @abstractmethod
    def validate_session(self, session_token: str) -> User | None:
        """校验会话并返回用户，过期 / 无效返回 ``None``。"""

    @abstractmethod
    def refresh_session(self, session_token: str) -> str:
        """刷新会话，返回新 token；旧 token 立即失效。

        :raises windup_common.exceptions.BizException: 会话无效。
        """

    # -- 密码 ------------------------------------------------------------

    @abstractmethod
    def change_password(self, user_id: int, input: ChangePasswordInput) -> None:
        """修改密码（需验证旧密码）。

        :raises windup_common.exceptions.BizException: 旧密码错误。
        """

    # -- 查询 ------------------------------------------------------------

    @abstractmethod
    def get_by_id(self, user_id: int) -> User | None:
        """按 ID 查询用户。"""

    @abstractmethod
    def get_by_email(self, email: str) -> User | None:
        """按邮箱查询用户。"""

    # 第三方认证暂不设计、不实现,因此没有 OAuth 绑定查询接口。