
"""FastAPI 应用工厂与装配入口。

``create_app`` 负责创建 FastAPI 实例并挂载路由 / 中间件 / 异常处理,
是整个 web 服务的唯一装配点(composition root)。

``main`` 是开发启动入口:``python -m windup_app`` 或 ``windup`` 命令。
"""

import os
from contextlib import asynccontextmanager

import windup_framework.db  # noqa: F401  组装时显式触发 DB engine/session 初始化
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from windup_app.web.api.character import router as character_router
from windup_app.web.api.generation import router as generation_router
from windup_app.web.api.media import router as media_router
from windup_app.web.api.project import router as project_router
from windup_app.web.handler.exception_handlers import register_exception_handlers


def _env_flag(name: str) -> bool:
    """把环境变量解析为真正的布尔值:仅 1/true/yes/on(忽略大小写与空白)视为 True。"""
    return os.getenv(name, "").strip().lower() in {"1", "true", "yes", "on"}



def _cors_origins() -> list[str]:
    """允许跨域的前端来源，逗号分隔的 WINDUP_CORS_ORIGINS 覆盖。

    不配这个中间件的话，浏览器会把前端的**所有**请求拦在预检那一步
    （OPTIONS 返回 405、响应无 access-control-* 头），后端日志里连请求都看不到。
    默认值覆盖本地 dev server 与 Vercel 预览域名。
    """
    raw = os.getenv("WINDUP_CORS_ORIGINS", "").strip()
    if raw:
        return [o.strip() for o in raw.split(",") if o.strip()]
    return ["http://localhost:5173", "http://127.0.0.1:5173",
            "http://localhost:3000", "http://127.0.0.1:3000"]


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
    app.add_middleware(
        CORSMiddleware,
        allow_origins=_cors_origins(),
        allow_origin_regex=r"https://.*\.vercel\.app",
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(project_router)
    app.include_router(character_router)
    app.include_router(media_router)
    app.include_router(generation_router)
    register_exception_handlers(app)
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
        reload=_env_flag("WINDUP_RELOAD"),
    )



if __name__ == "__main__":
        main()
