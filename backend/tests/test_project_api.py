"""项目 CRUD API 集成测试。

通过 ``TestClient`` 打全链路:请求 -> 路由 -> service -> SQLite -> 统一响应。
验证统一响应契约(HTTP 恒 200、code 在 body、``ListResponse`` 分页字段、
``timestamp`` 默认省略)与 400/404 业务码路径。
"""


def _payload(**overrides):
    """构造合法的创建请求体(对齐 ``ProjectCreate``)。"""
    base = {
        "project_name": "像素游戏",
        "character_perspective": 1,
        "directional_movement": 2,
        "sprite_width": 64,
        "sprite_height": 64,
    }
    base.update(overrides)
    return base


# -- POST /projects ----------------------------------------------------------


def test_create_success(auth_client):
    resp = auth_client.post("/projects", json=_payload(project_name="新建"))

    assert resp.status_code == 200
    body = resp.json()
    assert body["code"] == 200
    assert body["message"] == "创建成功"
    assert body["data"]["id"] is not None
    assert "user_id" not in body["data"]
    assert body["data"]["project_name"] == "新建"
    assert body["data"]["create_at"]
    assert "timestamp" not in body


def test_create_duplicate_name_returns_400(auth_client):
    auth_client.post("/projects", json=_payload(project_name="重名"))
    resp = auth_client.post("/projects", json=_payload(project_name="重名"))

    assert resp.status_code == 200
    body = resp.json()
    assert body["code"] == 400
    assert body["message"] == "项目名称已存在"
    assert body["data"] is None


def test_create_validation_error_returns_400(auth_client):
    resp = auth_client.post("/projects", json=_payload(project_name="x" * 21))

    assert resp.status_code == 200
    assert resp.json()["code"] == 400


# -- GET /projects/{id} ------------------------------------------------------


def test_get_success(auth_client):
    created = auth_client.post("/projects", json=_payload(project_name="详情")).json()[
        "data"
    ]
    resp = auth_client.get(f"/projects/{created['id']}")

    assert resp.json()["code"] == 200
    assert resp.json()["data"]["project_name"] == "详情"


def test_get_not_found_returns_404(auth_client):
    resp = auth_client.get("/projects/99999")

    body = resp.json()
    assert body["code"] == 404
    assert body["message"] == "项目不存在"
    assert body["data"] is None


# -- GET /projects -----------------------------------------------------------


def test_list_empty(auth_client):
    resp = auth_client.get("/projects")

    body = resp.json()
    assert body["code"] == 200
    assert body["data"] == []
    assert body["total"] == 0
    assert body["page"] == 1
    assert body["page_size"] == 20


def test_list_paginates(auth_client):
    for i in range(3):
        auth_client.post("/projects", json=_payload(project_name=f"a{i}"))

    resp = auth_client.get("/projects", params={"page": 1, "page_size": 2})

    body = resp.json()
    assert body["total"] == 3
    assert len(body["data"]) == 2
    assert [item["project_name"] for item in body["data"]] == ["a2", "a1"]
    assert all("user_id" not in item for item in body["data"])


# -- DELETE /projects/{id} ---------------------------------------------------


def test_delete_success(auth_client):
    created = auth_client.post("/projects", json=_payload(project_name="删除")).json()[
        "data"
    ]
    resp = auth_client.delete(f"/projects/{created['id']}")

    body = resp.json()
    assert body["code"] == 200
    assert body["message"] == "删除成功"
    assert auth_client.get(f"/projects/{created['id']}").json()["code"] == 404


def test_delete_not_found_returns_404(auth_client):
    resp = auth_client.delete("/projects/99999")

    assert resp.json()["code"] == 404


def test_delete_rejected_when_project_has_characters(auth_client):
    created = auth_client.post("/projects", json=_payload(project_name="有角色")).json()[
        "data"
    ]
    character = auth_client.post(
        "/characters",
        json={
            "project_id": created["id"],
            "workflow_run_id": 348,
            "name": "挂载角色",
            "description": "阻止删项目",
        },
    ).json()

    assert character["code"] == 200

    resp = auth_client.delete(f"/projects/{created['id']}")

    body = resp.json()
    assert body["code"] == 400
    assert body["message"] == "项目下仍有角色，无法删除"
    assert body["data"] is None
    assert auth_client.get(f"/projects/{created['id']}").json()["code"] == 200
    assert auth_client.get(f"/characters/{character['data']['id']}").json()["code"] == 200


def test_delete_rejected_when_character_arrives_after_empty_check(auth_client, monkeypatch):
    """模拟检查与删除之间插入角色：应用层已看见空项目，数据库仍应拦住删除。"""
    created = auth_client.post("/projects", json=_payload(project_name="竞态")).json()[
        "data"
    ]
    character = auth_client.post(
        "/characters",
        json={
            "project_id": created["id"],
            "workflow_run_id": 349,
            "name": "后插入",
            "description": "检查之后才出现",
        },
    ).json()
    assert character["code"] == 200

    monkeypatch.setattr(
        "windup_app.web.api.project.character_service.project_has_characters",
        lambda session, project_id: False,
    )

    resp = auth_client.delete(f"/projects/{created['id']}")

    body = resp.json()
    assert body["code"] == 400
    assert body["message"] == "项目下仍有角色，无法删除"
    assert auth_client.get(f"/projects/{created['id']}").json()["code"] == 200
    assert auth_client.get(f"/characters/{character['data']['id']}").json()["code"] == 200
