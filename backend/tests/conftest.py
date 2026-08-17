"""共享测试夹具。

用 SQLite 内存库(``StaticPool`` 单连接)做隔离,不依赖 Docker Postgres,
CI 友好。每个用例各自独立的 engine,互不污染。``Project`` 表按需创建在测试
engine 上(不碰全局 Postgres engine)。
"""

import os
import pathlib

# CI 环境可能未配置真实凭据,在 import 触发 Settings 实例化前提供测试默认值。
# setdefault 不覆盖已有的环境变量(本地 .env 或 CI secrets 优先生效)。
os.environ.setdefault("JWT_SECRET", "test-secret-key-for-ci-only-32chars")
os.environ.setdefault("POSTGRES_PASSWORD", "testpassword123")

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from windup_app.bootstrap.app import create_app
from windup_app.server.character.model import Character
from windup_app.server.project.model import Project
from windup_app.server.quota.model import CreditAccount, CreditTransaction
from windup_app.server.user.model import User
from windup_app.server.orchestrator.model import GenerationTaskRecord
from windup_app.server.workflow_run.model import WorkflowRun
from windup_app.server.user.service import create_access_token
from windup_framework.config.quota import settings as quota_settings
from windup_framework.db import Base, get_session


def insert_project(session, **overrides) -> Project:
    """写入一条合法项目，供需要 ``windup_character.project_id`` 外键的测试使用。"""
    fields = {
        "user_id": 1,
        "project_name": "测试项目",
        "character_perspective": 1,
        "directional_movement": 2,
        "sprite_width": 64,
        "sprite_height": 64,
    }
    fields.update(overrides)
    project = Project(**fields)
    session.add(project)
    session.flush()
    return project


def _disable_generation_execution(app):
    app.state.run_action_task = lambda *args: None
    app.state.run_image_task = lambda *args: None


def seed_credit_account(session, user_id: int, *, balance: int | None = None) -> CreditAccount:
    """给测试用户补一张积分账户（注册赠送口径）。"""
    gift = quota_settings.register_gift_amount
    account = CreditAccount(
        user_id=user_id,
        balance=gift if balance is None else balance,
        frozen=0,
        total_earned=gift,
        total_spent=0,
    )
    session.add(account)
    session.flush()
    return account


def _make_engine():
    """单连接内存 SQLite;``check_same_thread=False`` 让 TestClient 线程可共用。"""
    engine = create_engine(
        "sqlite:///:memory:",
        poolclass=StaticPool,
        connect_args={"check_same_thread": False},
    )

    @event.listens_for(engine, "connect")
    def _enable_sqlite_foreign_keys(dbapi_connection, _connection_record):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    return engine


@pytest.fixture()
def engine():
    """建好 ``windup_project`` 和 ``windup_user`` 表的内存 engine。"""
    engine = _make_engine()
    Base.metadata.create_all(engine, tables=[
        Project.__table__, User.__table__, Character.__table__, WorkflowRun.__table__,
        CreditAccount.__table__, CreditTransaction.__table__,
        GenerationTaskRecord.__table__,
    ])
    yield engine
    engine.dispose()


@pytest.fixture()
def db_session(engine):
    """绑定到测试 engine 的 session,供 service 层单测直接传入。"""
    session_local = sessionmaker(bind=engine, expire_on_commit=False)
    session = session_local()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture()
def client(engine):
    """FastAPI TestClient;覆盖 ``get_session`` 指向测试 engine。

    不进入 lifespan 上下文(跳过 ``print_banner`` 噪音);启动逻辑无 DB 依赖。
    """
    session_local = sessionmaker(bind=engine, expire_on_commit=False)

    def override_get_session():
        session = session_local()
        try:
            yield session
            session.commit()
        except Exception:
            session.rollback()
            raise
        finally:
            session.close()

    app = create_app()
    _disable_generation_execution(app)
    app.dependency_overrides[get_session] = override_get_session
    yield TestClient(app)
    app.state.generation_dispatcher.shutdown()
    app.dependency_overrides.clear()


@pytest.fixture()
def auth_client(engine):
    """带认证 token 的 FastAPI TestClient。

    自动在请求头中添加 Authorization Bearer token，绕过鉴权中间件。
    """
    session_local = sessionmaker(bind=engine, expire_on_commit=False)

    def override_get_session():
        session = session_local()
        try:
            yield session
            session.commit()
        except Exception:
            session.rollback()
            raise
        finally:
            session.close()

    app = create_app()
    _disable_generation_execution(app)
    app.dependency_overrides[get_session] = override_get_session

    # 生成测试用 token
    token = create_access_token(1, "test@example.com")
    client = TestClient(app, headers={"Authorization": f"Bearer {token}"})

    yield client
    app.state.generation_dispatcher.shutdown()
    app.dependency_overrides.clear()


@pytest.fixture()
def auth_client_b(engine):
    """另一个用户的认证 TestClient（user_id=2），用于跨用户权限测试。"""
    session_local = sessionmaker(bind=engine, expire_on_commit=False)

    def override_get_session():
        session = session_local()
        try:
            yield session
            session.commit()
        except Exception:
            session.rollback()
            raise
        finally:
            session.close()

    app = create_app()
    _disable_generation_execution(app)
    app.dependency_overrides[get_session] = override_get_session

    token = create_access_token(2, "other@example.com")
    client = TestClient(app, headers={"Authorization": f"Bearer {token}"})

    yield client
    app.state.generation_dispatcher.shutdown()
    app.dependency_overrides.clear()


# ── 三渲二 provider 的 fixture(随 provider3d 一起迁入)──────────────────
#
# 集成用例要真模型(减面 GLB / 已绑骨 FBX)。这些产物是跑过付费链路才有的、体积几十 MB,
# 不进仓;用 WINDUP_RENDER3D_ARTIFACTS 指向它们所在目录即可跑全套(实测 82/82 全过)。
# 不指就按仓内默认路径找,找不到**显式 skip 并打印缺哪个文件** —— 不静默当通过。
# 合成 GLB 的构造器在 tests/render3d_helpers.py(真实产物只有几个,覆盖不到边界)。
_ARTIFACTS = pathlib.Path(
    os.getenv("WINDUP_RENDER3D_ARTIFACTS")
    or pathlib.Path(__file__).resolve().parents[2] / "characters" / "oc_v4"
)
RIGGED_FBX = _ARTIFACTS / "rigged_despill.fbx"
DECIMATED_GLB = _ARTIFACTS / "model_std_draw15k.glb"


@pytest.fixture(scope="session")
def rigged_fbx() -> bytes:
    if not RIGGED_FBX.exists():
        pytest.skip(f"缺已绑骨产物 {RIGGED_FBX}")
    return RIGGED_FBX.read_bytes()


@pytest.fixture(scope="session")
def decimated_glb() -> bytes:
    if not DECIMATED_GLB.exists():
        pytest.skip(f"缺减面产物 {DECIMATED_GLB}")
    return DECIMATED_GLB.read_bytes()
