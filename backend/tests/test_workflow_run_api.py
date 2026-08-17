"""工作流执行记录 CRUD API 集成测试。"""


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
    """构造合法的创建执行记录请求体。"""
    base = {
        "project_id": project_id,
    }
    base.update(overrides)
    return base


# -- POST /workflow-runs ------------------------------------------------------


def test_create_success(auth_client):
    project = _create_project(auth_client)
    resp = auth_client.post("/workflow-runs", json=_payload(project["id"]))

    assert resp.status_code == 200
    body = resp.json()
    assert body["code"] == 200
    assert body["data"]["project_id"] == project["id"]
    assert body["data"]["nodes"] == []
    assert body["data"]["status"] == "active"
    assert body["data"]["version"] == 1


def test_create_with_nodes(auth_client):
    project = _create_project(auth_client)
    nodes = [{"id": "n1", "type": "start"}, {"id": "n2", "type": "end"}]
    resp = auth_client.post(
        "/workflow-runs", json=_payload(project["id"], nodes=nodes),
    )

    assert resp.json()["code"] == 200
    assert resp.json()["data"]["nodes"] == nodes


def test_create_under_other_users_project_returns_404(auth_client, auth_client_b):
    """用户 B 不能在用户 A 的项目下创建执行记录。"""
    project = _create_project(auth_client)
    resp = auth_client_b.post("/workflow-runs", json=_payload(project["id"]))

    assert resp.json()["code"] == 404
    assert resp.json()["message"] == "项目不存在"


# -- GET /workflow-runs --------------------------------------------------------


def test_list_empty(auth_client):
    project = _create_project(auth_client)
    resp = auth_client.get(
        "/workflow-runs", params={"project_id": project["id"]},
    )

    body = resp.json()
    assert body["code"] == 200
    assert body["data"] == []
    assert body["total"] == 0


def test_list_paginates(auth_client):
    project = _create_project(auth_client)
    for _ in range(3):
        auth_client.post("/workflow-runs", json=_payload(project["id"]))

    resp = auth_client.get(
        "/workflow-runs",
        params={"project_id": project["id"], "page": 1, "page_size": 2},
    )

    body = resp.json()
    assert body["total"] == 3
    assert len(body["data"]) == 2


def test_list_excludes_soft_deleted(auth_client):
    project = _create_project(auth_client)
    r1 = auth_client.post("/workflow-runs", json=_payload(project["id"])).json()["data"]
    auth_client.post("/workflow-runs", json=_payload(project["id"]))

    # 软删除 r1
    auth_client.delete(f"/workflow-runs/{r1['id']}")

    resp = auth_client.get(
        "/workflow-runs", params={"project_id": project["id"]},
    )
    assert resp.json()["total"] == 1


def test_list_other_users_project_returns_404(auth_client, auth_client_b):
    """用户 B 不能列出用户 A 项目的执行记录。"""
    project = _create_project(auth_client)
    auth_client.post("/workflow-runs", json=_payload(project["id"]))

    resp = auth_client_b.get(
        "/workflow-runs", params={"project_id": project["id"]},
    )
    assert resp.json()["code"] == 404


# -- GET /workflow-runs/{id} ---------------------------------------------------


def test_get_success(auth_client):
    project = _create_project(auth_client)
    created = auth_client.post(
        "/workflow-runs", json=_payload(project["id"]),
    ).json()["data"]

    resp = auth_client.get(f"/workflow-runs/{created['id']}")

    assert resp.json()["code"] == 200
    assert resp.json()["data"]["id"] == created["id"]


def test_get_not_found_returns_404(auth_client):
    resp = auth_client.get("/workflow-runs/99999")

    assert resp.json()["code"] == 404
    assert resp.json()["message"] == "执行记录不存在"


def test_get_other_users_run_returns_404(auth_client, auth_client_b):
    """用户 B 不能查看用户 A 的执行记录。"""
    project = _create_project(auth_client)
    created = auth_client.post(
        "/workflow-runs", json=_payload(project["id"]),
    ).json()["data"]

    resp = auth_client_b.get(f"/workflow-runs/{created['id']}")

    assert resp.json()["code"] == 404


# -- PATCH /workflow-runs/{id} -------------------------------------------------


def test_update_nodes(auth_client):
    project = _create_project(auth_client)
    created = auth_client.post(
        "/workflow-runs", json=_payload(project["id"]),
    ).json()["data"]

    new_nodes = [{"id": "n1", "type": "action"}]
    resp = auth_client.patch(
        f"/workflow-runs/{created['id']}",
        json={"nodes": new_nodes, "version": created["version"]},
    )

    assert resp.json()["code"] == 200
    assert resp.json()["data"]["nodes"] == new_nodes
    assert resp.json()["data"]["version"] == 2


def test_update_status(auth_client):
    project = _create_project(auth_client)
    created = auth_client.post(
        "/workflow-runs", json=_payload(project["id"]),
    ).json()["data"]

    resp = auth_client.patch(
        f"/workflow-runs/{created['id']}",
        json={"status": "soft_deleted", "version": created["version"]},
    )

    assert resp.json()["code"] == 200
    assert resp.json()["data"]["status"] == "soft_deleted"


def test_update_invalid_status_returns_400(auth_client):
    project = _create_project(auth_client)
    created = auth_client.post(
        "/workflow-runs", json=_payload(project["id"]),
    ).json()["data"]

    resp = auth_client.patch(
        f"/workflow-runs/{created['id']}",
        json={"status": "bogus", "version": created["version"]},
    )

    assert resp.json()["code"] == 400


def test_update_other_users_run_returns_404(auth_client, auth_client_b):
    """用户 B 不能修改用户 A 的执行记录。"""
    project = _create_project(auth_client)
    created = auth_client.post(
        "/workflow-runs", json=_payload(project["id"]),
    ).json()["data"]

    resp = auth_client_b.patch(
        f"/workflow-runs/{created['id']}",
        json={"nodes": [], "version": created["version"]},
    )

    assert resp.json()["code"] == 404


def test_update_requires_version(auth_client):
    project = _create_project(auth_client)
    created = auth_client.post(
        "/workflow-runs", json=_payload(project["id"]),
    ).json()["data"]

    resp = auth_client.patch(
        f"/workflow-runs/{created['id']}", json={"nodes": []},
    )

    assert resp.json()["code"] == 400


def test_update_noop_does_not_increment_version(auth_client):
    project = _create_project(auth_client)
    created = auth_client.post(
        "/workflow-runs", json=_payload(project["id"]),
    ).json()["data"]

    resp = auth_client.patch(
        f"/workflow-runs/{created['id']}", json={"version": created["version"]},
    )

    assert resp.json()["code"] == 200
    assert resp.json()["data"]["version"] == created["version"]


def test_update_noop_stale_version_returns_409(auth_client):
    project = _create_project(auth_client)
    created = auth_client.post(
        "/workflow-runs", json=_payload(project["id"]),
    ).json()["data"]

    auth_client.patch(
        f"/workflow-runs/{created['id']}",
        json={"nodes": [{"id": "n1"}], "version": created["version"]},
    )

    resp = auth_client.patch(
        f"/workflow-runs/{created['id']}", json={"version": created["version"]},
    )

    assert resp.json()["code"] == 409
    assert "冲突" in resp.json()["message"]


def test_update_stale_version_returns_409(auth_client):
    project = _create_project(auth_client)
    created = auth_client.post(
        "/workflow-runs", json=_payload(project["id"]),
    ).json()["data"]

    auth_client.patch(
        f"/workflow-runs/{created['id']}",
        json={"nodes": [{"id": "n1"}], "version": created["version"]},
    )

    resp = auth_client.patch(
        f"/workflow-runs/{created['id']}",
        json={"nodes": [{"id": "n2"}], "version": created["version"]},
    )

    assert resp.json()["code"] == 409
    assert "冲突" in resp.json()["message"]


# -- DELETE /workflow-runs/{id} ------------------------------------------------


def test_delete_success(auth_client):
    project = _create_project(auth_client)
    created = auth_client.post(
        "/workflow-runs", json=_payload(project["id"]),
    ).json()["data"]

    resp = auth_client.delete(f"/workflow-runs/{created['id']}")

    assert resp.json()["code"] == 200
    assert resp.json()["message"] == "删除成功"

    # 删除后列表不包含该记录
    resp = auth_client.get(
        "/workflow-runs", params={"project_id": project["id"]},
    )
    assert resp.json()["total"] == 0


def test_patch_after_delete_does_not_restore_run(auth_client):
    project = _create_project(auth_client)
    created = auth_client.post(
        "/workflow-runs", json=_payload(project["id"]),
    ).json()["data"]

    auth_client.delete(f"/workflow-runs/{created['id']}")

    resp = auth_client.patch(
        f"/workflow-runs/{created['id']}",
        json={"nodes": [{"id": "n1"}], "version": created["version"]},
    )

    assert resp.json()["code"] == 409
    got = auth_client.get(f"/workflow-runs/{created['id']}").json()["data"]
    assert got["status"] == "soft_deleted"
    assert got["nodes"] == []
    assert got["version"] == created["version"] + 1


def test_delete_not_found_returns_404(auth_client):
    resp = auth_client.delete("/workflow-runs/99999")

    assert resp.json()["code"] == 404


def test_delete_other_users_run_returns_404(auth_client, auth_client_b):
    """用户 B 不能删除用户 A 的执行记录。"""
    project = _create_project(auth_client)
    created = auth_client.post(
        "/workflow-runs", json=_payload(project["id"]),
    ).json()["data"]

    resp = auth_client_b.delete(f"/workflow-runs/{created['id']}")

    assert resp.json()["code"] == 404
