"""管理 API 的唯一装配入口。"""

from fastapi import APIRouter, Depends

from windup_app.web.admin.auth import protected_router, public_router
from windup_app.web.admin.dependencies import require_admin_user

router = APIRouter(prefix="/admin-api")
router.include_router(public_router)

authenticated_router = APIRouter(dependencies=[Depends(require_admin_user)])
authenticated_router.include_router(protected_router)
router.include_router(authenticated_router)
