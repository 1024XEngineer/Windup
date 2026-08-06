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
    """允许跨域的前端来源；逗号分隔的 ``WINDUP_CORS_ORIGINS`` 覆盖。

    不挂这个中间件的话，浏览器会把前端的**所有**请求拦在预检那一步
    （OPTIONS 返回 405、响应无 access-control-* 头），而且后端日志里连请求都看不到，
    很容易被误判成前端问题。默认值覆盖本地 dev server。
    """
    raw = os.getenv("WINDUP_CORS_ORIGINS", "").strip()
    if raw:
        return [o.strip() for o in raw.split(",") if o.strip()]
    # 5173 = vite dev、4173 = vite preview(生产构建，本地看真实构建走这个)、3000 = 备用
    return ["http://localhost:5173", "http://127.0.0.1:5173",
            "http://localhost:4173", "http://127.0.0.1:4173",
            "http://localhost:3000", "http://127.0.0.1:3000"]


def _cors_origin_regex() -> str | None:
    """预览域名的来源正则；由 ``WINDUP_CORS_ORIGIN_REGEX`` 提供，默认不开。

    这里**不写死** ``https://.*\\.vercel\\.app``：下面 ``allow_credentials=True``，
    那条正则等于把带凭证的跨域请求放行给整个 vercel.app 域下的任意第三方应用，
    而且显式配了 ``WINDUP_CORS_ORIGINS`` 也关不掉它。预览域名形态随部署环境变，
    所以交给部署方自己配，例如 ``https://<项目名>-[a-z0-9-]+\\.vercel\\.app``
    （starlette 用 ``fullmatch``，不必自己加 ``^$``）。
    """
    raw = os.getenv("WINDUP_CORS_ORIGIN_REGEX", "").strip()
    return raw or None


def create_app() -> FastAPI:
    app = FastAPI(title="windup", version="0.1.0")

    app.add_middleware(
        CORSMiddleware,
        allow_origins=_cors_origins(),
        allow_origin_regex=_cors_origin_regex(),
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # 业务路由
    app.include_router(media_router)
    app.include_router(generation_router)
    app.include_router(workflow_run_router)
    app.include_router(ai_router)

    return app
