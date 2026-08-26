"""认证 API。

提供注册、登录、发码、刷新、登出、当前用户、修改密码等端点。
"""

import logging

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, ConfigDict, Field, EmailStr, field_validator
from sqlalchemy.orm import Session

from windup_common.result import Response

from windup_framework.db import get_session

from windup_app.server.user.model import (
    RegisterInput,
    ResetPasswordInput,
    UpdateNicknameInput,
    User,
    UserView,
)
from windup_app.server.user.service import service

logger = logging.getLogger("windup.auth.api")

router = APIRouter(prefix="/auth", tags=["auth"])


# -- 请求模型 ------------------------------------------------------------


class RegisterRequest(BaseModel):
    """注册请求。"""

    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    code: str = Field(min_length=6, max_length=6, description="邮箱验证码")
    nickname: str | None = Field(default=None, max_length=50)
    invite_code: str | None = Field(
        default=None,
        max_length=16,
        description="邀请链接中的邀请码，选填；有则发双方邀请奖励",
    )

    @field_validator("invite_code", mode="before")
    @classmethod
    def blank_invite_code(cls, value: object) -> object:
        if isinstance(value, str) and not value.strip():
            return None
        return value


class LoginRequest(BaseModel):
    """密码登录请求。"""

    email: EmailStr
    password: str


class SendCodeRequest(BaseModel):
    """发送验证码请求。"""

    email: EmailStr
    purpose: str = Field(default="login", pattern="^(login|register|reset_password)$")


class LoginByCodeRequest(BaseModel):
    """验证码登录请求。"""

    email: EmailStr
    code: str = Field(min_length=6, max_length=6)


class RefreshRequest(BaseModel):
    """刷新 token 请求。"""

    refresh_token: str


class ChangePasswordRequest(BaseModel):
    """修改密码请求。"""

    old_password: str
    new_password: str = Field(min_length=8, max_length=128)


class UpdateNicknameRequest(BaseModel):
    """修改昵称请求。"""

    nickname: str = Field(min_length=1, max_length=50)


class ResetPasswordRequest(BaseModel):
    """重置密码请求（忘记密码场景）。"""

    email: EmailStr
    code: str = Field(
        min_length=6, max_length=6, description="reset_password 用途的验证码"
    )
    new_password: str = Field(min_length=8, max_length=128)


# -- 响应模型 ------------------------------------------------------------


class TokenResponse(BaseModel):
    """登录/注册/刷新成功响应。"""

    model_config = ConfigDict(from_attributes=True)

    access_token: str
    refresh_token: str
    user: UserView


class UserOut(BaseModel):
    """用户信息响应（脱敏）。"""

    model_config = ConfigDict(from_attributes=True)

    id: int
    email: str
    nickname: str | None = None
    email_verified_at: str | None = None
    status: int = 0


# -- 路由 ----------------------------------------------------------------


@router.post("/register", response_model=Response[TokenResponse])
def register(body: RegisterRequest, session: Session = Depends(get_session)):
    """邮箱+验证码+密码注册。邀请码选填。"""
    result = service.register_by_email(
        session,
        RegisterInput(
            email=body.email,
            password=body.password,
            code=body.code,
            nickname=body.nickname,
            invite_code=body.invite_code,
        ),
    )
    return Response.success(
        TokenResponse(
            access_token=result.access_token,
            refresh_token=result.refresh_token,
            user=result.user,
        ),
        message="注册成功",
    )


@router.post("/login", response_model=Response[TokenResponse])
def login(body: LoginRequest, session: Session = Depends(get_session)):
    """邮箱+密码+验证码登录。"""
    result = service.login_by_password(
        session,
        type(
            "LoginByPasswordInput", (), {"email": body.email, "password": body.password}
        )(),
    )
    return Response.success(
        TokenResponse(
            access_token=result.access_token,
            refresh_token=result.refresh_token,
            user=result.user,
        ),
        message="登录成功",
    )


@router.post("/send-code", response_model=Response[None])
def send_code(body: SendCodeRequest):
    """发送邮箱验证码。"""
    service.send_verification_code(body.email, body.purpose)
    return Response.success(None, message="验证码已发送")


@router.post("/login-by-code", response_model=Response[TokenResponse])
def login_by_code(body: LoginByCodeRequest, session: Session = Depends(get_session)):
    """验证码登录。未知邮箱自动建号并赠送注册积分。"""
    result = service.login_by_code(
        session,
        type("LoginByCodeInput", (), {"email": body.email, "code": body.code})(),
    )
    return Response.success(
        TokenResponse(
            access_token=result.access_token,
            refresh_token=result.refresh_token,
            user=result.user,
        ),
        message="登录成功",
    )


@router.post("/refresh", response_model=Response[TokenResponse])
def refresh(body: RefreshRequest):
    """刷新 token。"""
    result = service.refresh_tokens(body.refresh_token)
    return Response.success(
        TokenResponse(
            access_token=result.access_token,
            refresh_token=result.refresh_token,
            user=result.user,
        ),
    )


@router.post("/logout", response_model=Response[None])
def logout(body: RefreshRequest):
    """登出，撤销 refresh_token。"""
    service.logout(body.refresh_token)
    return Response.success(None, message="已登出")


@router.get("/me", response_model=Response[UserOut])
def get_me(request: Request, session: Session = Depends(get_session)):
    """获取当前用户信息。"""
    current_user = request.state.current_user
    user = session.get(User, current_user.id)
    if user is None:
        from windup_common.enums.biz_code import BizCode
        from windup_common.exceptions import BizException

        raise BizException("用户不存在", code=BizCode.NOT_FOUND)
    return Response.success(
        UserOut(
            id=user.id,
            email=user.email,
            nickname=user.nickname,
            email_verified_at=user.email_verified_at.isoformat()
            if user.email_verified_at
            else None,
            status=user.status,
        )
    )


@router.post("/change-password", response_model=Response[None])
def change_password(
    body: ChangePasswordRequest,
    request: Request,
    session: Session = Depends(get_session),
):
    """修改密码。"""
    current_user = request.state.current_user
    service.change_password(
        session,
        current_user.id,
        type(
            "ChangePasswordInput",
            (),
            {"old_password": body.old_password, "new_password": body.new_password},
        )(),
    )
    return Response.success(None, message="密码修改成功")


@router.post("/reset-password", response_model=Response[None])
def reset_password(body: ResetPasswordRequest, session: Session = Depends(get_session)):
    """邮箱+验证码重置密码（忘记密码）。"""
    service.reset_password(
        session,
        ResetPasswordInput(
            email=body.email, code=body.code, new_password=body.new_password
        ),
    )
    return Response.success(None, message="密码重置成功")


@router.patch("/profile", response_model=Response[UserOut])
def update_nickname(
    body: UpdateNicknameRequest,
    request: Request,
    session: Session = Depends(get_session),
):
    """修改当前用户昵称。"""
    current_user = request.state.current_user
    user_view = service.update_nickname(
        session, current_user.id, UpdateNicknameInput(nickname=body.nickname)
    )
    return Response.success(
        UserOut(
            id=user_view.id,
            email=user_view.email,
            nickname=user_view.nickname,
            email_verified_at=user_view.email_verified_at.isoformat()
            if user_view.email_verified_at
            else None,
            status=user_view.status,
        ),
        message="昵称修改成功",
    )
