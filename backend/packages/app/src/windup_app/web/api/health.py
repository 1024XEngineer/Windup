"""健康检查路由。"""

from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.orm import Session

from windup_framework.db import get_session

router = APIRouter(tags=["health"])


@router.get("/health")
def health() -> dict[str, str]:
    """健康检查,用于验证服务是否启动。"""
    return {"status": "ok"}


@router.get("/health/db")
def health_db(session: Session = Depends(get_session)) -> dict[str, str]:
    """数据库连接检查,执行 SELECT 1 验证连通性。"""
    session.execute(text("SELECT 1"))
    return {"status": "ok"}
