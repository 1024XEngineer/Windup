"""健康检查路由测试:用 dependency override 注入假 session,不连真实库。"""

from fastapi.testclient import TestClient

from windup_app.bootstrap.app import create_app
from windup_framework.db import get_session


class _FakeSession:
    """最小假 session:execute 返回 None,commit/rollback/close 无副作用。"""

    def execute(self, *_args, **_kwargs):
        return None

    def commit(self) -> None:
        pass

    def rollback(self) -> None:
        pass

    def close(self) -> None:
        pass


def _fake_get_session():
    yield _FakeSession()


def _client() -> TestClient:
    app = create_app()
    app.dependency_overrides[get_session] = _fake_get_session
    return TestClient(app)


def test_health_ok():
    resp = _client().get("/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


def test_health_db_ok():
    resp = _client().get("/health/db")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}
