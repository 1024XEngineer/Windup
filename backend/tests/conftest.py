"""共享测试夹具。

用 SQLite 内存库(``StaticPool`` 单连接)做隔离,不依赖 Docker Postgres,
CI 友好。每个用例各自独立的 engine,互不污染。``Project`` 表按需创建在测试
engine 上(不碰全局 Postgres engine)。
"""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from windup_app.bootstrap.app import create_app
from windup_app.server.project.model import Project
from windup_framework.db import Base, get_session


def _make_engine():
    """单连接内存 SQLite;``check_same_thread=False`` 让 TestClient 线程可共用。"""
    return create_engine(
        "sqlite:///:memory:",
        poolclass=StaticPool,
        connect_args={"check_same_thread": False},
    )


@pytest.fixture()
def engine():
    """建好 ``windup_project`` 表的内存 engine。"""
    engine = _make_engine()
    Base.metadata.create_all(engine, tables=[Project.__table__])
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
    app.dependency_overrides[get_session] = override_get_session
    yield TestClient(app)
    app.dependency_overrides.clear()
