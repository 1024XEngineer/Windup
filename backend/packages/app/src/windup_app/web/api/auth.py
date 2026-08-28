"""认证 API。

提供注册、登录、发码、刷新、登出、当前用户、修改密码等端点。
"""

import asyncio
import logging

from fastapi import APIRouter, Depends, File, Request, UploadFile
from pydantic import BaseModel, ConfigDict, Field, EmailStr, field_validator
from sqlalchemy.orm import Session

from windup_common.result import Response
from windup_common.enums.biz_code import BizCode
from windup_common.exceptions import BizException
from windup_common.enums.media import MediaCategory

from windup_framework.db import get_session

from windup_app.server.user.model import (
    EmailChangePasswordInput,
    RegisterInput,
    ResetPasswordInput,
    SetPasswordInput,
    UpdateNicknameInput,
    User,
    UserView,
)
from windup_app.server.user.service import _has_password, service
from windup_app.server.media.model import MediaUploadInput
from windup_app.server.media.service import service as media_service
from windup_app.server.media.validation import validate_image_magic

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


class SetPasswordRequest(BaseModel):
    """设置初始密码请求。"""

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


class EmailChangePasswordRequest(BaseModel):
    """当前登录账号的邮箱验证码改密请求。"""

    model_config = ConfigDict(extra="forbid")

    code: str = Field(pattern=r"^\d{6}$")
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
    avatar_url: str | None = None
    email_verified_at: str | None = None
    status: int = 0
    has_password: bool = False


def _user_out_from_orm(user: User) -> UserOut:
    return UserOut(
        id=user.id,
        email=user.email,
        nickname=user.nickname,
        avatar_url=user.avatar_url,
        email_verified_at=user.email_verified_at.isoformat()
        if user.email_verified_at
        else None,
        status=user.status,
        has_password=_has_password(user.password_hash),
    )


def _user_out_from_view(user: UserView) -> UserOut:
    return UserOut(
        id=user.id,
        email=user.email,
        nickname=user.nickname,
        avatar_url=user.avatar_url,
        email_verified_at=user.email_verified_at.isoformat()
        if user.email_verified_at
        else None,
        status=int(user.status),
        has_password=user.has_password,
    )


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
def refresh(body: RefreshRequest, session: Session = Depends(get_session)):
    """刷新 token。"""
    result = service.refresh_tokens(session, body.refresh_token)
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
    return Response.success(_user_out_from_orm(user))


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


@router.post("/set-password", response_model=Response[None])
def set_password(
    body: SetPasswordRequest,
    request: Request,
    session: Session = Depends(get_session),
):
    """设置初始密码（仅未设密码用户）。"""
    current_user = request.state.current_user
    service.set_password(
        session,
        current_user.id,
        SetPasswordInput(new_password=body.new_password),
    )
    return Response.success(None, message="密码设置成功")


@router.post("/change-password/send-code", response_model=Response[None])
def send_password_change_code(request: Request):
    """向当前登录账号的邮箱发送改密验证码。"""
    service.send_verification_code(
        request.state.current_user.email,
        "change_password",
    )
    return Response.success(None, message="验证码已发送")


@router.post("/change-password/confirm", response_model=Response[None])
def change_password_by_email(
    body: EmailChangePasswordRequest,
    request: Request,
    session: Session = Depends(get_session),
):
    """核验当前登录账号的邮箱验证码并修改密码。"""
    service.change_password_by_email(
        session,
        request.state.current_user.id,
        EmailChangePasswordInput(code=body.code, new_password=body.new_password),
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
    return Response.success(_user_out_from_view(user_view), message="昵称修改成功")


@router.post("/profile/avatar", response_model=Response[UserOut])
async def update_avatar(
    request: Request,
    file: UploadFile = File(...),
    session: Session = Depends(get_session),
):
    """上传并持久化当前用户头像。"""
    content_type = file.content_type or ""
    allowed_types = {"image/png", "image/jpeg", "image/gif", "image/webp"}
    if content_type not in allowed_types:
        raise BizException(
            "头像仅支持 PNG、JPEG、GIF 或 WebP", code=BizCode.BAD_REQUEST
        )

    size_limit = 5 * 1024 * 1024
    data = bytearray()
    while chunk := await file.read(64 * 1024):
        if len(data) + len(chunk) > size_limit:
            raise BizException("头像大小不能超过 5 MB", code=BizCode.BAD_REQUEST)
        data.extend(chunk)
    if not validate_image_magic(data, content_type):
        raise BizException("头像内容与声明的类型不匹配", code=BizCode.BAD_REQUEST)

    metadata = MediaUploadInput(
        filename=file.filename or "avatar",
        content_type=content_type,
        size=len(data),
        category=MediaCategory.AVATAR,
    )
    uploaded = await asyncio.to_thread(media_service.upload, bytes(data), metadata)
    user = session.get(User, request.state.current_user.id)
    if user is None:
        raise BizException("用户不存在", code=BizCode.NOT_FOUND)
    user.avatar_url = uploaded.url
    session.flush()
    return Response.success(_user_out_from_orm(user), message="头像已更新")
