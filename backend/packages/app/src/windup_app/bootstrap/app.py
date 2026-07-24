"""FastAPI 应用工厂与装配入口。

``create_app`` 负责创建 FastAPI 实例并挂载路由 / 中间件 / 异常处理,
是整个 web 服务的唯一装配点(composition root)。

``main`` 是开发启动入口:``python -m windup_app`` 或 ``windup`` 命令。
"""

import os
from contextlib import asynccontextmanager

import windup_framework.db
from fastapi import FastAPI

from windup_app.bootstrap.banner import print_banner
from windup_app.web.api.health import router as health_router


@asynccontextmanager
async def _lifespan(app: FastAPI):
    """应用启动时打印 banner,关闭时无特殊处理。"""
    print_banner()
    yield


def create_app() -> FastAPI:
    app = FastAPI(title="windup", version="0.1.0", lifespan=_lifespan)
    app.include_router(health_router)
    return app


def main() -> None:
    """开发启动入口:用 uvicorn 跑 ``create_app``。

    host/port/reload 可用 ``WINDUP_HOST`` / ``WINDUP_PORT`` / ``WINDUP_RELOAD`` 覆盖。
    """
    import uvicorn

    uvicorn.run(
        "windup_app.bootstrap.app:create_app",
        factory=True,
        host=os.getenv("WINDUP_HOST", "127.0.0.1"),
        port=int(os.getenv("WINDUP_PORT", "8000")),
        reload=bool(os.getenv("WINDUP_RELOAD")),
    )



if __name__ == "__main__":
        main()
