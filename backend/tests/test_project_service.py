"""``SqlAlchemyProjectService`` 单元测试。

直接把测试 session 传入 service 方法,验证 CRUD 语义:生成字段、唯一约束、
分页、按 id 倒序、按 user 过滤、删除幂等。
"""

import pytest
from sqlalchemy.exc import IntegrityError

from windup_app.server.project.model import Project
from windup_app.server.project.service import service


def _fields(**overrides):
    """构造合法的项目字段(对齐 ``ProjectCreate`` 字段集)。"""
    base = {
        "user_id": 10001,
        "project_name": "像素游戏",
        "character_perspective": 1,
        "directional_movement": 2,
        "sprite_width": 64,
        "sprite_height": 64,
    }
    base.update(overrides)
    return base


# -- create ------------------------------------------------------------------


def test_create_returns_project_with_generated_fields(db_session):
    project = service.create_project(db_session, **_fields(project_name="新建"))

    assert project.id is not None
    assert project.create_at is not None
    assert project.update_at is not None
    assert project.user_id == 10001
    assert project.project_name == "新建"


def test_create_persists_and_is_queryable(db_session):
    created = service.create_project(db_session, **_fields(project_name="持久化"))

    fetched = db_session.get(Project, created.id)
    assert fetched is not None
    assert fetched.project_name == "持久化"


def test_create_duplicate_name_raises_integrity_error(db_session):
    service.create_project(db_session, **_fields(project_name="重名"))

    with pytest.raises(IntegrityError):
        service.create_project(db_session, **_fields(project_name="重名"))


# -- project_name_exists -----------------------------------------------------


def test_name_exists_false_when_absent(db_session):
    assert service.project_name_exists(db_session, user_id=10001, project_name="无") is False


def test_name_exists_true_when_present(db_session):
    service.create_project(db_session, **_fields(user_id=10001, project_name="已存在"))

    assert service.project_name_exists(db_session, user_id=10001, project_name="已存在") is True


def test_name_exists_scoped_per_user(db_session):
    service.create_project(db_session, **_fields(user_id=10001, project_name="共享名"))

    assert service.project_name_exists(db_session, user_id=20002, project_name="共享名") is False


# -- get ---------------------------------------------------------------------


def test_get_returns_none_when_not_found(db_session):
    assert service.get_project(db_session, 99999) is None


def test_get_returns_project_when_found(db_session):
    created = service.create_project(db_session, **_fields(project_name="查询"))

    assert service.get_project(db_session, created.id).project_name == "查询"


# -- list --------------------------------------------------------------------


def test_list_empty(db_session):
    items, total = service.list_projects(db_session, page=1, page_size=20)

    assert items == []
    assert total == 0


def test_list_paginates_and_orders_by_id_desc(db_session):
    for i in range(5):
        service.create_project(db_session, **_fields(project_name=f"p{i}"))

    items, total = service.list_projects(db_session, page=1, page_size=2)

    assert total == 5
    assert [p.project_name for p in items] == ["p4", "p3"]


def test_list_second_page(db_session):
    for i in range(5):
        service.create_project(db_session, **_fields(project_name=f"p{i}"))

    items, total = service.list_projects(db_session, page=2, page_size=2)

    assert total == 5
    assert [p.project_name for p in items] == ["p2", "p1"]


def test_list_filters_by_user(db_session):
    service.create_project(db_session, **_fields(user_id=10001, project_name="a"))
    service.create_project(db_session, **_fields(user_id=20002, project_name="b"))

    items, total = service.list_projects(db_session, page=1, page_size=20, user_id=20002)

    assert total == 1
    assert [p.project_name for p in items] == ["b"]


# -- delete ------------------------------------------------------------------


def test_delete_returns_false_when_not_found(db_session):
    assert service.delete_project(db_session, 99999) is False


def test_delete_removes_and_returns_true(db_session):
    created = service.create_project(db_session, **_fields(project_name="删除"))

    assert service.delete_project(db_session, created.id) is True
    assert service.get_project(db_session, created.id) is None
