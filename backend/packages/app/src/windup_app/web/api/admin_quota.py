"""管理员积分兑换码 API。"""

import logging
from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends, Request
from pydantic import AwareDatetime, BaseModel, Field, model_validator
from sqlalchemy.orm import Session

from windup_common.exceptions import BizException
from windup_common.result import Response
from windup_framework.config.admin import settings as admin_settings
from windup_framework.db import get_session

from windup_app.server.quota.redemption import create_codes, inspect_code
from windup_app.server.user.model import User, UserStatus

router = APIRouter(prefix="/admin/quota/redemption-codes", tags=["admin-quota"])
logger = logging.getLogger("windup.admin.quota.api")


class AdminAccessOut(BaseModel):
    """管理页访问探针响应。"""

    allowed: bool


class GenerateCodesIn(BaseModel):
    """批量生成兑换码参数。"""

    count: int = Field(ge=1, le=100)
    amount: int = Field(ge=1, le=1_000_000)
    expires_at: AwareDatetime | None = None

    @model_validator(mode="after")
    def future_expiry(self) -> "GenerateCodesIn":
        if self.expires_at is not None and self.expires_at <= datetime.now(timezone.utc):
            raise ValueError("有效期必须晚于当前时间")
        return self


class GeneratedCodesOut(BaseModel):
    """明文只随本次响应返回。"""

    count: int
    amount: int
    expires_at: datetime | None
    codes: list[str]


class ValidateCodeIn(BaseModel):
    """待核验的兑换码。"""

    code: str = Field(max_length=64)


class ValidateCodeOut(BaseModel):
    """兑换码只读核验结果。"""

    status: Literal["valid", "redeemed", "expired", "not_found", "invalid_format"]
    amount: int | None
    expires_at: datetime | None
    redeemed_at: datetime | None


def require_admin_user(
    request: Request,
    session: Session = Depends(get_session),
) -> User:
    """重新读取数据库用户，并校验状态与服务端邮箱白名单。"""
    user = session.get(User, request.state.current_user.id)
    if (
        user is None
        or user.status != UserStatus.NORMAL
        or user.email.strip().lower() not in admin_settings.admin_email_set
    ):
        raise BizException("没有管理员权限", code=403)
    return user


@router.get("/access", response_model=Response[AdminAccessOut])
def check_admin_access(
    _admin: User = Depends(require_admin_user),
) -> Response[AdminAccessOut]:
    """供管理页加载时确认当前会话是否具备管理员权限。"""
    return Response.success(AdminAccessOut(allowed=True))


@router.post("", response_model=Response[GeneratedCodesOut])
def generate_redemption_codes(
    payload: GenerateCodesIn,
    session: Session = Depends(get_session),
    admin: User = Depends(require_admin_user),
) -> Response[GeneratedCodesOut]:
    """批量生成兑换码；数据库只保存摘要，明文只返回一次。"""
    codes = create_codes(
        session,
        count=payload.count,
        amount=payload.amount,
        expires_at=payload.expires_at,
    )
    logger.info(
        "[WINDUP] 管理员生成兑换码 | admin_user_id=%s count=%s amount=%s expires_at=%s",
        admin.id,
        payload.count,
        payload.amount,
        payload.expires_at,
    )
    return Response.success(
        GeneratedCodesOut(
            count=len(codes),
            amount=payload.amount,
            expires_at=payload.expires_at,
            codes=codes,
        )
    )


@router.post("/validate", response_model=Response[ValidateCodeOut])
def validate_redemption_code(
    payload: ValidateCodeIn,
    session: Session = Depends(get_session),
    admin: User = Depends(require_admin_user),
) -> Response[ValidateCodeOut]:
    """核验兑换码状态，不消费兑换码，也不修改积分数据。"""
    inspected = inspect_code(session, payload.code)
    logger.info(
        "[WINDUP] 管理员核验兑换码 | admin_user_id=%s status=%s",
        admin.id,
        inspected.status,
    )
    return Response.success(
        ValidateCodeOut(
            status=inspected.status,
            amount=inspected.amount,
            expires_at=inspected.expires_at,
            redeemed_at=inspected.redeemed_at,
        )
    )
