"""项目 API 接口测试。"""

from datetime import datetime, timezone
from unittest.mock import Mock

from fastapi.testclient import TestClient

from windup_app.bootstrap.app import create_app
from windup_app.server.project.model import Project
from windup_framework.db import get_session


class _FakeSession:
    """不连接真实数据库的请求级 session 占位对象。"""


def _project(project_id: int = 1, user_id: int = 1, name: str = "Demo") -> Project:
    """构造用于响应校验的 ORM 对象。"""
    project = Project(
        id=project_id,
        user_id=user_id,
        project_name=name,
        character_perspective=1,
        directional_movement=2,
        sprite_width=64,
        sprite_height=64,
        game_style="pixel",
        sprite_sample_url=None,
        workflow_id=None,
    )
    now = datetime.now(timezone.utc)
    project.create_at = now
    project.update_at = now
    return project


def _client() -> tuple[TestClient, _FakeSession]:
    app = create_app()
    session = _FakeSession()

    def override_session():
        yield session

    app.dependency_overrides[get_session] = override_session
    return TestClient(app), session


def _payload(name: str = "Demo", user_id: int = 1) -> dict:
    return {
        "user_id": user_id,
        "project_name": name,
        "character_perspective": 1,
        "directional_movement": 2,
        "sprite_width": 64,
        "sprite_height": 64,
        "game_style": "pixel",
    }


def test_create_project_returns_generated_primary_key(monkeypatch):
    """创建成功响应应包含数据库生成的项目主键。"""
    client, session = _client()
    project = _project(project_id=123)
    monkeypatch.setattr(
        "windup_app.server.project.service.project_name_exists", lambda *args, **kwargs: False
    )
    monkeypatch.setattr(
        "windup_app.server.project.service.create_project", lambda *args, **kwargs: project
    )

    response = client.post("/projects", json=_payload())

    assert response.status_code == 200
    body = response.json()
    assert body["code"] == 200
    assert body["message"] == "创建成功"
    assert body["data"]["id"] == 123


def test_create_project_rejects_duplicate_name_for_same_user(monkeypatch):
    """同一用户重复项目名称应返回业务错误。"""
    client, _ = _client()
    create_project = Mock()
    monkeypatch.setattr(
        "windup_app.server.project.service.project_name_exists", lambda *args, **kwargs: True
    )
    monkeypatch.setattr("windup_app.server.project.service.create_project", create_project)

    response = client.post("/projects", json=_payload())

    assert response.status_code == 200
    assert response.json() == {
        "code": 400,
        "message": "项目名称已存在",
        "data": None,
    }
    create_project.assert_not_called()


def test_same_name_is_allowed_for_different_user(monkeypatch):
    """不同用户可以使用相同项目名称。"""
    client, session = _client()
    project = _project(project_id=2, user_id=2)
    exists = Mock(return_value=False)
    monkeypatch.setattr("windup_app.server.project.service.project_name_exists", exists)
    monkeypatch.setattr(
        "windup_app.server.project.service.create_project", lambda *args, **kwargs: project
    )

    response = client.post("/projects", json=_payload(user_id=2))

    assert response.status_code == 200
    assert response.json()["data"]["id"] == 2
    exists.assert_called_once_with(session, user_id=2, project_name="Demo")


def test_list_projects_returns_pagination(monkeypatch):
    """列表接口返回项目数据及分页信息。"""
    client, _ = _client()
    monkeypatch.setattr(
        "windup_app.server.project.service.list_projects",
        lambda *args, **kwargs: ([_project(1), _project(2, name="Demo 2")], 8),
    )

    response = client.get("/projects?page=2&page_size=2&user_id=1")

    assert response.status_code == 200
    body = response.json()
    assert body["data"][0]["id"] == 1
    assert body["data"][1]["project_name"] == "Demo 2"
    assert body["total"] == 8
    assert body["page"] == 2
    assert body["page_size"] == 2


def test_get_project_returns_project(monkeypatch):
    """单个查询接口返回项目详情。"""
    client, _ = _client()
    monkeypatch.setattr(
        "windup_app.server.project.service.get_project", lambda *args, **kwargs: _project(9)
    )

    response = client.get("/projects/9")

    assert response.status_code == 200
    assert response.json()["data"]["id"] == 9


def test_get_project_returns_not_found(monkeypatch):
    """查询不存在项目时返回 404 业务码。"""
    client, _ = _client()
    monkeypatch.setattr(
        "windup_app.server.project.service.get_project", lambda *args, **kwargs: None
    )

    response = client.get("/projects/999")

    assert response.status_code == 200
    assert response.json() == {
        "code": 404,
        "message": "项目不存在",
        "data": None,
    }


def test_delete_project_returns_success(monkeypatch):
    """删除存在的项目时返回成功。"""
    client, _ = _client()
    monkeypatch.setattr(
        "windup_app.server.project.service.delete_project", lambda *args, **kwargs: True
    )

    response = client.delete("/projects/1")

    assert response.status_code == 200
    assert response.json() == {
        "code": 200,
        "message": "删除成功",
        "data": None,
    }
