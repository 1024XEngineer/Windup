"""角色 CRUD API 集成测试。"""


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
        "name": "勇者",
        "description": "主角",
    }
    base.update(overrides)
    return base


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
    assert resp.json()["data"]["name"] is None


def test_create_name_roundtrip(auth_client):
    """名称持久化后可通过 GET 读回。"""
    project = _create_project(auth_client)
    created = auth_client.post(
        "/characters", json=_payload(project["id"], name="小精灵"),
    ).json()["data"]

    resp = auth_client.get(f"/characters/{created['id']}")
    assert resp.json()["data"]["name"] == "小精灵"
