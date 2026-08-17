
"""FastAPI 应用工厂与装配入口。

``create_app`` 负责创建 FastAPI 实例并挂载路由 / 中间件 / 异常处理,
是整个 web 服务的唯一装配点(composition root)。

``main`` 是开发启动入口:``python -m windup_app`` 或 ``windup`` 命令。
"""

import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from windup_framework.db import Base, engine, SessionLocal

# 模型导入：触发 Base.metadata 注册，确保 create_all 能发现所有表
from windup_ai_engine.impl.character_namer import LangChainCharacterNamer
from windup_app.server.character.model import Character  # noqa: F401
from windup_app.server.character.service import service as character_service
from windup_app.server.orchestrator.dispatcher import GenerationDispatcher
from windup_app.server.project.model import Project  # noqa: F401
from windup_app.server.quota.model import CreditAccount, CreditTransaction  # noqa: F401
# InviteCode, InviteRecord, TokenUsage 暂不实现
from windup_app.server.user.model import User  # noqa: F401
from windup_app.server.workflow_run.model import WorkflowRun  # noqa: F401
from windup_app.web.api.auth import router as auth_router
from windup_app.web.api.character import router as character_router
from windup_app.server.orchestrator import task_repo
from windup_app.server.orchestrator.executor import run_action_task, run_image_task
from windup_app.web.api.generation import router as generation_router
from windup_app.web.api.media import router as media_router
from windup_app.web.api.project import router as project_router
from windup_app.web.api.quota import router as quota_router
from windup_app.web.api.workflow_run import router as workflow_run_router
from windup_app.web.handler.exception_handlers import register_exception_handlers
from windup_app.web.middleware.auth import AuthMiddleware


def _env_flag(name: str) -> bool:
    """把环境变量解析为真正的布尔值:仅 1/true/yes/on(忽略大小写与空白)视为 True。"""
    return os.getenv(name, "").strip().lower() in {"1", "true", "yes", "on"}



def _cors_origins() -> list[str]:
    """允许跨域的前端来源，逗号分隔的 WINDUP_CORS_ORIGINS 覆盖。

    不配这个中间件的话，浏览器会把前端的**所有**请求拦在预检那一步
    （OPTIONS 返回 405、响应无 access-control-* 头），后端日志里连请求都看不到。
    默认值仅覆盖本地 dev server；远程来源必须显式配置。
    """
    raw = os.getenv("WINDUP_CORS_ORIGINS", "").strip()
    if raw:
        return [o.strip() for o in raw.split(",") if o.strip()]
    return ["http://localhost:5173", "http://127.0.0.1:5173",
            "http://localhost:3000", "http://127.0.0.1:3000"]


def _cors_origin_regex() -> str | None:
    """CORS 正则匹配的额外来源，WINDUP_CORS_ORIGIN_REGEX 覆盖。

    默认不允许正则来源，避免信任任意第三方托管子域名。
    """
    return os.getenv("WINDUP_CORS_ORIGIN_REGEX", "").strip() or None


def print_banner() -> None:
    """启动时打印 banner(占位实现,后续替换为正式 ASCII banner)。"""
    print("windup 0.1.0 starting ...")


@asynccontextmanager
async def _lifespan(app: FastAPI):
    """应用启动时建表，关闭时等待已排队的生成任务收敛。"""
    Base.metadata.create_all(engine)
    print_banner()
    _recover_orphaned_generation(app)
    try:
        yield
    finally:
        app.state.generation_dispatcher.shutdown()


def _recover_orphaned_generation(app: FastAPI) -> None:
    """启动时把仍冻结的 PENDING 任务重新入队，RUNNING 孤儿失败并解冻。"""
    from windup_app.server.orchestrator.recover import recover_orphaned_generation_tasks

    session = SessionLocal()
    try:
        recover_orphaned_generation_tasks(
            session,
            dispatcher=app.state.generation_dispatcher,
            run_image_task=app.state.run_image_task,
            run_action_task=app.state.run_action_task,
        )
        session.commit()
    except Exception:
        session.rollback()
        logging.getLogger("windup.bootstrap").exception("生成任务对账失败")
    finally:
        session.close()


def create_app() -> FastAPI:
    app = FastAPI(title="windup", version="0.1.0", lifespan=_lifespan)
    app.state.generation_dispatcher = GenerationDispatcher()
    # 起名器在 composition root 注入,避免 web→character.service 碰到 ai_engine。
    # LangChainCharacterNamer 构造期不创建 ChatOpenAI；缺 AI_API_KEY 时应用仍能启动。
    # 测试若已注入假 namer，不要覆盖。
    if character_service._namer is None:
        character_service._namer = LangChainCharacterNamer()

    @app.get("/health", include_in_schema=False)
    def health() -> dict[str, str]:
        return {"status": "ok"}

    # 中间件（add_middleware 后加的先执行：请求先进 CORS → 再进 Auth → 最后到路由）
    app.add_middleware(AuthMiddleware)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=_cors_origins(),
        allow_origin_regex=_cors_origin_regex(),
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(auth_router)
    app.include_router(project_router)
    app.include_router(character_router)
    app.include_router(workflow_run_router)
    app.include_router(media_router)
    app.include_router(generation_router)
    app.include_router(quota_router)
    # 生成任务的后台执行器挂到 app.state:端点只建 PENDING 记录立即返回,真正的
    # 图生图/i2v 在后台线程跑。放在 state 而不是 import 到 web 层,是因为
    # import-linter 的分层契约禁止 app.web 直连 ai_engine,而 executor 要调它。
    app.state.run_action_task = run_action_task
    app.state.run_image_task = run_image_task

    # task_repo 状态变更时自动推 SSE。延迟 import 避免与 generation 模块循环依赖。
    from windup_app.web.api.generation import event_bus

    task_repo.bind_event_bus(event_bus)
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
