"""角色 CRUD API 集成测试。"""

import pytest

from windup_app.server.character.model import Character
from windup_app.server.character.service import service as character_service
from windup_common.enums.character import CharacterStatus


class _FakeNamer:
    def name_from_description(self, description: str) -> str:
        return f"名:{description}"[:20]


@pytest.fixture(autouse=True)
def _inject_fake_character_namer():
    original = character_service._namer
    character_service._namer = _FakeNamer()
    try:
        yield
    finally:
        character_service._namer = original


def _create_project(auth_client, name: str = "默认项目") -> dict:
    """创建一个项目并返回响应 data。"""
    return auth_client.post("/projects", json={
        "project_name": name,
        "character_perspective": 1,
        "directional_movement": 2,
        "sprite_width": 64,
        "sprite_height": 64,
    }).json()["data"]


def _payload(project_id: int, **overrides):
    """构造合法的创建角色请求体。"""
    base = {
        "project_id": project_id,
        "workflow_run_id": 1,
        "name": "勇者",
        "description": "主角",
    }
    base.update(overrides)
    return base


def _payload_with_frames(project_id: int, **overrides):
    """构造包含真实帧的创建角色请求体。"""
    base = {
        "project_id": project_id,
        "workflow_run_id": 1,
        "name": "有帧角色",
        "description": "包含真实帧",
        "character_data": {
            "outfits": [{
                "id": "outfit-1",
                "name": "默认造型",
                "actions": [{
                    "id": "action-1",
                    "type": "idle",
                    "name": "待机",
                    "frame_count": 1,
                    "frames": [{"index": 0, "image_url": "https://example.com/frame.png"}],
                }],
            }],
        },
    }
    base.update(overrides)
    return base


def test_character_model_defaults_to_draft(db_session):
    """非 API 写入也不得把尚无真实动作帧的角色默认为已发布。"""
    from conftest import insert_project

    project = insert_project(db_session)
    character = Character(project_id=project.id, workflow_run_id=999, character_data={})
    db_session.add(character)
    db_session.flush()

    assert character.status == CharacterStatus.DRAFT


# -- POST /characters --------------------------------------------------------


def test_create_with_name(auth_client):
    project = _create_project(auth_client)
    resp = auth_client.post("/characters", json=_payload(project["id"]))

    assert resp.status_code == 200
    body = resp.json()
    assert body["code"] == 200
    assert body["data"]["name"] == "勇者"
    assert body["data"]["description"] == "主角"
    assert body["data"]["project_id"] == project["id"]


def test_create_without_name(auth_client):
    project = _create_project(auth_client)
    resp = auth_client.post("/characters", json=_payload(project["id"], name=None))

    assert resp.json()["code"] == 200
    assert resp.json()["data"]["name"] == "名:主角"


def test_create_name_roundtrip(auth_client):
    """名称持久化后可通过 GET 读回。"""
    project = _create_project(auth_client)
    created = auth_client.post(
        "/characters", json=_payload(project["id"], name="小精灵"),
    ).json()["data"]

    resp = auth_client.get(f"/characters/{created['id']}")
    assert resp.json()["data"]["name"] == "小精灵"


def test_create_same_workflow_run_returns_existing_character(auth_client):
    project = _create_project(auth_client)
    payload = _payload(project["id"], workflow_run_id=42)

    first = auth_client.post("/characters", json=payload).json()
    second = auth_client.post("/characters", json=payload).json()
    listed = auth_client.get("/characters", params={"project_id": project["id"]}).json()

    assert first["code"] == 200
    assert second["code"] == 200
    assert second["data"]["id"] == first["data"]["id"]
    assert listed["total"] == 1
    assert [character["id"] for character in listed["data"]] == [first["data"]["id"]]


# -- 跨用户权限校验 -------------------------------------------------------------


def test_create_under_other_users_project_returns_404(auth_client, auth_client_b):
    """用户 B 不能在用户 A 的项目下创建角色。"""
    project = _create_project(auth_client)
    resp = auth_client_b.post("/characters", json=_payload(project["id"]))

    assert resp.json()["code"] == 404
    assert resp.json()["message"] == "项目不存在"


def test_create_same_workflow_run_under_another_project_returns_404(
    auth_client, auth_client_b,
):
    project_a = _create_project(auth_client, "用户 A 项目")
    project_b = _create_project(auth_client_b, "用户 B 项目")
    created = auth_client.post(
        "/characters", json=_payload(project_a["id"], workflow_run_id=42),
    ).json()["data"]

    resp = auth_client_b.post(
        "/characters", json=_payload(project_b["id"], workflow_run_id=42),
    )

    assert resp.json()["code"] == 404
    assert resp.json()["data"] is None
    assert auth_client.get(f"/characters/{created['id']}").json()["code"] == 200


def test_list_other_users_project_characters_returns_404(auth_client, auth_client_b):
    """用户 B 不能列出用户 A 项目下的角色。"""
    project = _create_project(auth_client)
    auth_client.post("/characters", json=_payload(project["id"]))

    resp = auth_client_b.get("/characters", params={"project_id": project["id"]})

    assert resp.json()["code"] == 404
    assert resp.json()["message"] == "项目不存在"


def test_get_other_users_character_returns_404(auth_client, auth_client_b):
    """用户 B 不能查看用户 A 的角色。"""
    project = _create_project(auth_client)
    created = auth_client.post(
        "/characters", json=_payload(project["id"]),
    ).json()["data"]

    resp = auth_client_b.get(f"/characters/{created['id']}")

    assert resp.json()["code"] == 404
    assert resp.json()["message"] == "角色不存在"


def test_update_other_users_character_returns_404(auth_client, auth_client_b):
    """用户 B 不能修改用户 A 的角色。"""
    project = _create_project(auth_client)
    created = auth_client.post(
        "/characters", json=_payload(project["id"]),
    ).json()["data"]

    resp = auth_client_b.patch(
        f"/characters/{created['id']}", json={"name": "黑化"},
    )

    assert resp.json()["code"] == 404
    assert resp.json()["message"] == "角色不存在"


def test_delete_other_users_character_returns_404(auth_client, auth_client_b):
    """用户 B 不能删除用户 A 的角色。"""
    project = _create_project(auth_client)
    created = auth_client.post(
        "/characters", json=_payload(project["id"]),
    ).json()["data"]

    resp = auth_client_b.delete(f"/characters/{created['id']}")

    assert resp.json()["code"] == 404
    assert resp.json()["message"] == "角色不存在"


# -- 角色发布状态过滤 ---------------------------------------------------------


def test_create_character_without_frames_is_draft(auth_client):
    """没有真实帧的角色应自动标记为草稿(status=0)。"""
    project = _create_project(auth_client)
    resp = auth_client.post("/characters", json=_payload(project["id"]))

    assert resp.status_code == 200
    assert resp.json()["data"]["status"] == 0


def test_create_character_with_frames_is_published(auth_client):
    """包含真实帧的角色应自动标记为已发布(status=1)。"""
    project = _create_project(auth_client)
    resp = auth_client.post("/characters", json=_payload_with_frames(project["id"]))

    assert resp.status_code == 200
    assert resp.json()["data"]["status"] == 1


def test_list_characters_filter_by_status(auth_client):
    """按 status 过滤角色列表。"""
    project = _create_project(auth_client)
    # 创建草稿角色
    auth_client.post("/characters", json=_payload(project["id"], workflow_run_id=1))
    # 创建已发布角色
    auth_client.post("/characters", json=_payload_with_frames(project["id"], workflow_run_id=2))

    # 查询已发布角色
    resp = auth_client.get("/characters", params={"project_id": project["id"], "status": 1})
    data = resp.json()
    assert data["code"] == 200
    assert data["total"] == 1
    assert len(data["data"]) == 1
    assert data["data"][0]["status"] == 1

    # 查询草稿角色
    resp = auth_client.get("/characters", params={"project_id": project["id"], "status": 0})
    data = resp.json()
    assert data["code"] == 200
    assert data["total"] == 1
    assert len(data["data"]) == 1
    assert data["data"][0]["status"] == 0


def test_list_characters_without_status_returns_all(auth_client):
    """不传 status 参数时返回所有角色。"""
    project = _create_project(auth_client)
    auth_client.post("/characters", json=_payload(project["id"], workflow_run_id=1))
    auth_client.post("/characters", json=_payload_with_frames(project["id"], workflow_run_id=2))

    resp = auth_client.get("/characters", params={"project_id": project["id"]})
    data = resp.json()
    assert data["code"] == 200
    assert data["total"] == 2
    assert len(data["data"]) == 2


def test_update_character_data_recalculates_status(auth_client):
    """更新 character_data 后应自动重新计算 status。"""
    project = _create_project(auth_client)
    created = auth_client.post(
        "/characters", json=_payload(project["id"]),
    ).json()["data"]

    # 初始为草稿
    assert created["status"] == 0

    # 更新为包含帧的数据
    resp = auth_client.patch(
        f"/characters/{created['id']}",
        json={
            "character_data": {
                "outfits": [{
                    "id": "outfit-1",
                    "name": "默认造型",
                    "actions": [{
                        "id": "action-1",
                        "type": "idle",
                        "name": "待机",
                        "frame_count": 1,
                        "frames": [{"index": 0, "image_url": "https://example.com/frame.png"}],
                    }],
                }],
            },
        },
    )
    assert resp.status_code == 200
    assert resp.json()["data"]["status"] == 1


def test_update_character_with_null_character_data(auth_client):
    """更新 character_data 为 null 时应返回 400 错误。"""
    project = _create_project(auth_client)
    created = auth_client.post(
        "/characters", json=_payload_with_frames(project["id"]),
    ).json()["data"]

    # 更新 character_data 为 null
    resp = auth_client.patch(
        f"/characters/{created['id']}",
        json={"character_data": None},
    )
    assert resp.json()["code"] == 400
    assert resp.json()["message"] == "character_data 不能为 null"
