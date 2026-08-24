"""项目 CRUD API 集成测试。

通过 ``TestClient`` 打全链路:请求 -> 路由 -> service -> SQLite -> 统一响应。
验证统一响应契约(HTTP 恒 200、code 在 body、``ListResponse`` 分页字段、
``timestamp`` 默认省略)与 400/404 业务码路径。
"""

from sqlalchemy import event


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


def _create_character(auth_client, project_id, workflow_run_id, **overrides):
    payload = {
        "project_id": project_id,
        "workflow_run_id": workflow_run_id,
        "name": f"角色 {workflow_run_id}",
        "character_data": {"version": 1, "outfits": []},
    }
    payload.update(overrides)
    body = auth_client.post("/characters", json=payload).json()
    assert body["code"] == 200
    return body["data"]


def test_list_includes_project_preview_fallbacks(auth_client):
    outfit_project = auth_client.post(
        "/projects", json=_payload(project_name="造型预览", directional_movement=1)
    ).json()["data"]
    reference_project = auth_client.post(
        "/projects", json=_payload(project_name="参考图预览", directional_movement=1)
    ).json()["data"]
    frame_project = auth_client.post(
        "/projects", json=_payload(project_name="帧预览", directional_movement=1)
    ).json()["data"]
    auth_client.post(
        "/projects", json=_payload(project_name="空项目", directional_movement=1)
    )

    _create_character(
        auth_client,
        outfit_project["id"],
        601,
        reference_image_url="https://cdn.windup.test/reference-unused.png",
        character_data={
            "version": 1,
            "outfits": [
                {
                    "id": "outfit-1",
                    "name": "常态",
                    "preview_url": "https://cdn.windup.test/outfit.png",
                    "actions": [],
                }
            ],
        },
    )
    _create_character(
        auth_client,
        reference_project["id"],
        602,
        reference_image_url="https://cdn.windup.test/reference.png",
    )
    _create_character(
        auth_client,
        frame_project["id"],
        603,
        character_data={
            "version": 1,
            "outfits": [
                {
                    "id": "outfit-3",
                    "name": "常态",
                    "preview_url": None,
                    "actions": [
                        {
                            "id": "idle",
                            "type": "idle",
                            "name": "待机",
                            "loop": True,
                            "fps": 8,
                            "frame_count": 1,
                            "frames": [
                                {
                                    "index": 0,
                                    "image_url": "https://cdn.windup.test/frame.png",
                                }
                            ],
                        }
                    ],
                }
            ],
        },
    )

    body = auth_client.get("/projects", params={"page_size": 10}).json()
    previews = {item["project_name"]: item["preview_url"] for item in body["data"]}

    assert previews == {
        "空项目": None,
        "帧预览": "https://cdn.windup.test/frame.png",
        "参考图预览": "https://cdn.windup.test/reference.png",
        "造型预览": "https://cdn.windup.test/outfit.png",
    }


def test_list_loads_all_project_previews_with_one_character_query(auth_client, engine):
    first = auth_client.post(
        "/projects", json=_payload(project_name="固定查询一")
    ).json()["data"]
    second = auth_client.post(
        "/projects", json=_payload(project_name="固定查询二")
    ).json()["data"]
    _create_character(auth_client, first["id"], 611)
    _create_character(auth_client, second["id"], 612)
    statements = []

    def record_character_select(
        _conn, _cursor, statement, _parameters, _context, _many
    ):
        normalized = statement.lower()
        if (
            normalized.lstrip().startswith("select")
            and "windup_character" in normalized
        ):
            statements.append(statement)

    event.listen(engine, "before_cursor_execute", record_character_select)
    try:
        body = auth_client.get("/projects", params={"page_size": 10}).json()
    finally:
        event.remove(engine, "before_cursor_execute", record_character_select)

    assert body["code"] == 200
    assert len(statements) == 1


# -- PATCH /projects/{id} ----------------------------------------------------


def test_rename_success_persists_the_new_name(auth_client):
    created = auth_client.post(
        "/projects", json=_payload(project_name="重命名前")
    ).json()["data"]

    resp = auth_client.patch(
        f"/projects/{created['id']}", json={"project_name": "重命名后"}
    )

    body = resp.json()
    assert body["code"] == 200
    assert body["message"] == "重命名成功"
    assert body["data"]["project_name"] == "重命名后"
    persisted = auth_client.get(f"/projects/{created['id']}").json()["data"]
    assert persisted["project_name"] == "重命名后"


def test_rename_duplicate_name_returns_400(auth_client):
    auth_client.post("/projects", json=_payload(project_name="已存在"))
    created = auth_client.post(
        "/projects", json=_payload(project_name="待修改")
    ).json()["data"]

    resp = auth_client.patch(
        f"/projects/{created['id']}", json={"project_name": "已存在"}
    )

    assert resp.json()["code"] == 400
    assert resp.json()["message"] == "项目名称已存在"
    persisted = auth_client.get(f"/projects/{created['id']}").json()["data"]
    assert persisted["project_name"] == "待修改"


def test_rename_rejects_another_users_project(auth_client, auth_client_b):
    created = auth_client.post(
        "/projects", json=_payload(project_name="我的项目")
    ).json()["data"]

    resp = auth_client_b.patch(
        f"/projects/{created['id']}", json={"project_name": "越权改名"}
    )

    assert resp.json()["code"] == 404
    assert (
        auth_client.get(f"/projects/{created['id']}").json()["data"]["project_name"]
        == "我的项目"
    )


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
    created = auth_client.post(
        "/projects", json=_payload(project_name="有角色")
    ).json()["data"]
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
    assert (
        auth_client.get(f"/characters/{character['data']['id']}").json()["code"] == 200
    )


def test_delete_rejected_when_character_arrives_after_empty_check(
    auth_client, monkeypatch
):
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
    assert (
        auth_client.get(f"/characters/{character['data']['id']}").json()["code"] == 200
    )
