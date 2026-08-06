"""FastAPI 应用工厂与装配入口。

``create_app`` 负责创建 FastAPI 实例并挂载路由 / 中间件 / 异常处理,
是整个 web 服务的唯一装配点(composition root)。
"""

import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from windup_app.web.api.agent import router as ai_router
from windup_app.web.api.generation import router as generation_router
from windup_app.web.api.media import router as media_router
from windup_app.web.api.workflow_run import router as workflow_run_router


def _cors_origins() -> list[str]:
    """开发阶段全放行；部署时用 ``WINDUP_CORS_ORIGINS``(逗号分隔)收窄。"""
    raw = os.getenv("WINDUP_CORS_ORIGINS", "").strip()
    return [o.strip() for o in raw.split(",") if o.strip()] or ["*"]


def create_app() -> FastAPI:
    app = FastAPI(title="windup", version="0.1.0")

    # 鉴权走 Authorization 头不走 cookie，故关掉 credentials —— 这样 "*" 才合法。
    app.add_middleware(
        CORSMiddleware,
        allow_origins=_cors_origins(),
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/health", tags=["ops"])
    def health() -> dict[str, str]:
        """存活探针。

        容器 HEALTHCHECK 不打 ``/docs`` —— 生产通常会关掉交互文档
        (``docs_url=None``)，那时健康检查会永远失败，容器被反复判死。
        """
        return {"status": "ok"}

    # 业务路由
    app.include_router(media_router)
    app.include_router(generation_router)
    app.include_router(workflow_run_router)
    app.include_router(ai_router)

    return app
