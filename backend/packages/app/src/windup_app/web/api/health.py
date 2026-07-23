from fastapi import APIRouter

router = APIRouter(tags=["health"])


@router.get("/health")
def health() -> dict[str, str]:
    """健康检查,用于验证服务是否启动。"""
    return {"status": "ok"}
