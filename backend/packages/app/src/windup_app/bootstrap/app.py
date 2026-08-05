"""FastAPI 应用工厂与装配入口。

``create_app`` 负责创建 FastAPI 实例并挂载路由 / 中间件 / 异常处理,
是整个 web 服务的唯一装配点(composition root)。
"""

from fastapi import FastAPI

from windup_app.web.api.agent import router as ai_router
from windup_app.web.api.media import router as media_router
from windup_app.web.api.workflow_run import router as workflow_run_router
from windup_app.web.sse import EventBus, sse_router


def create_app() -> FastAPI:
    app = FastAPI(title="windup", version="0.1.0")

    # SSE 基础设施
    app.state.event_bus = EventBus()
    app.include_router(sse_router)

    # 业务路由
    app.include_router(media_router)
    app.include_router(workflow_run_router)
    app.include_router(ai_router)

    return app
