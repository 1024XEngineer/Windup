
"""FastAPI 应用工厂与装配入口。

``create_app`` 负责创建 FastAPI 实例并挂载路由 / 中间件 / 异常处理,
是整个 web 服务的唯一装配点(composition root)。

``main`` 是开发启动入口:``python -m windup_app`` 或 ``windup`` 命令。
"""

import os
from contextlib import asynccontextmanager

import windup_framework.db  # noqa: F401  组装时显式触发 DB engine/session 初始化
from fastapi import FastAPI

from windup_app.server.orchestrator.executor import run_action_task, run_image_task
from windup_app.web.api.auth import router as auth_router
from windup_app.web.api.character import router as character_router
from windup_app.web.api.generation import router as generation_router
from windup_app.web.api.media import router as media_router
from windup_app.web.api.project import router as project_router
from windup_app.web.handler.exception_handlers import register_exception_handlers
from windup_app.web.middleware.auth import AuthMiddleware
from windup_app.web.middleware.ratelimit import RateLimitMiddleware


def _env_flag(name: str) -> bool:
    """把环境变量解析为真正的布尔值:仅 1/true/yes/on(忽略大小写与空白)视为 True。"""
    return os.getenv(name, "").strip().lower() in {"1", "true", "yes", "on"}


def print_banner() -> None:
    """启动时打印 banner(占位实现,后续替换为正式 ASCII banner)。"""
    print("windup 0.1.0 starting ...")


@asynccontextmanager
async def _lifespan(app: FastAPI):
    """应用启动时打印 banner,关闭时无特殊处理。"""
    print_banner()
    yield


def create_app() -> FastAPI:
    app = FastAPI(title="windup", version="0.1.0", lifespan=_lifespan)

    # 中间件（执行顺序：请求先进 RateLimit，再进 Auth，最后到路由）
    app.add_middleware(RateLimitMiddleware)
    app.add_middleware(AuthMiddleware)

    # 路由
    app.include_router(auth_router)
    app.include_router(project_router)
    app.include_router(character_router)
    app.include_router(media_router)
    app.include_router(generation_router)

    # 生成后台调度器注入 app.state
    app.state.run_action_task = run_action_task
    app.state.run_image_task = run_image_task

    register_exception_handlers(app)
    return app


def main() -> None:
    """开发启动入口:用 uvicorn 跑 ``create_app``。"""
    import uvicorn

    uvicorn.run(
        "windup_app.bootstrap.app:create_app",
        factory=True,
        host=os.getenv("WINDUP_HOST", "127.0.0.1"),
        port=int(os.getenv("WINDUP_PORT", "8000")),
        reload=_env_flag("WINDUP_RELOAD"),
    )


if __name__ == "__main__":
    main()
