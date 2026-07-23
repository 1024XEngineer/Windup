"""FastAPI 应用工厂与装配入口。

``create_app`` 负责创建 FastAPI 实例并挂载路由 / 中间件 / 异常处理,
是整个 web 服务的唯一装配点(composition root)。
"""

from fastapi import FastAPI

from windup_app.web.api.health import router as health_router


def create_app() -> FastAPI:
    app = FastAPI(title="windup", version="0.1.0")
    app.include_router(health_router)
    return app
