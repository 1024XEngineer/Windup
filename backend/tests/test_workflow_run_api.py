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

def test_list_without_project_returns_only_current_users_recent_runs(
    auth_client,
    auth_client_b,
):
    """Quick Start 历史栏能一次读取当前用户跨项目的最近运行记录。"""
    first_project = _create_project(auth_client, "像素骑士")
    second_project = _create_project(auth_client, "森林法师")
    other_project = _create_project(auth_client_b, "别人的角色")

    first = auth_client.post(
        "/workflow-runs",
        json=_payload(first_project["id"], nodes=[{"id": "first"}]),
    ).json()["data"]
    second = auth_client.post(
        "/workflow-runs",
        json=_payload(second_project["id"], nodes=[{"id": "second"}]),
    ).json()["data"]
    auth_client_b.post("/workflow-runs", json=_payload(other_project["id"]))

    resp = auth_client.get("/workflow-runs", params={"page": 1, "page_size": 20})

    body = resp.json()
    assert body["code"] == 200
    assert body["total"] == 2
    assert [item["id"] for item in body["data"]] == [second["id"], first["id"]]
    assert all(item["created_at"] for item in body["data"])


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


# -- GET/PUT /workflow-runs/{id}/agent-conversation --------------------------


def _conversation_turns() -> list[dict]:
    return [
        {"role": "user", "content": "创建一个像素骑士"},
        {
            "role": "assistant",
            "content": "我整理了一版生成方案。",
            "kind": "proposal",
            "proposalId": "proposal-1",
            "optimizedPrompt": "像素骑士，银色盔甲",
            "optimizationSummary": "补充了材质和轮廓",
            "proposalStatus": "confirmed",
        },
    ]


def test_get_missing_agent_conversation_returns_empty_snapshot(auth_client):
    project = _create_project(auth_client)
    run = auth_client.post(
        "/workflow-runs",
        json=_payload(project["id"]),
    ).json()["data"]

    resp = auth_client.get(f"/workflow-runs/{run['id']}/agent-conversation")

    assert resp.status_code == 200
    assert resp.json()["data"] == {
        "run_id": run["id"],
        "turns": [],
        "schema_version": 2,
        "version": 0,
        "updated_at": None,
    }


def test_put_agent_conversation_persists_full_snapshot(auth_client):
    project = _create_project(auth_client)
    run = auth_client.post(
        "/workflow-runs",
        json=_payload(project["id"]),
    ).json()["data"]
    turns = _conversation_turns()

    saved = auth_client.put(
        f"/workflow-runs/{run['id']}/agent-conversation",
        json={"turns": turns, "schema_version": 2, "version": 0},
    )
    loaded = auth_client.get(f"/workflow-runs/{run['id']}/agent-conversation")

    assert saved.status_code == 200
    assert saved.json()["data"]["version"] == 1
    assert saved.json()["data"]["updated_at"]
    assert loaded.json()["data"]["turns"] == turns
    assert loaded.json()["data"]["version"] == 1


def test_put_agent_conversation_appends_after_reopening_history(auth_client):
    project = _create_project(auth_client)
    run = auth_client.post(
        "/workflow-runs",
        json=_payload(project["id"]),
    ).json()["data"]
    url = f"/workflow-runs/{run['id']}/agent-conversation"
    original_turns = _conversation_turns()
    created = auth_client.put(
        url,
        json={"turns": original_turns, "schema_version": 2, "version": 0},
    )
    assert created.status_code == 200

    reopened = auth_client.get(url).json()["data"]
    appended_turn = {"role": "user", "content": "几天后继续完善披风细节"}
    appended_turns = [*reopened["turns"], appended_turn]
    saved = auth_client.put(
        url,
        json={
            "turns": appended_turns,
            "schema_version": reopened["schema_version"],
            "version": reopened["version"],
        },
    )
    loaded = auth_client.get(url).json()["data"]

    assert saved.status_code == 200
    assert saved.json()["data"]["run_id"] == run["id"]
    assert saved.json()["data"]["version"] == 2
    assert loaded["turns"] == [*original_turns, appended_turn]
    assert loaded["version"] == 2


def test_put_agent_conversation_replays_the_same_snapshot_idempotently(auth_client):
    project = _create_project(auth_client)
    run = auth_client.post(
        "/workflow-runs",
        json=_payload(project["id"]),
    ).json()["data"]
    url = f"/workflow-runs/{run['id']}/agent-conversation"
    payload = {"turns": _conversation_turns(), "schema_version": 2, "version": 0}

    created = auth_client.put(url, json=payload)
    replayed = auth_client.put(url, json=payload)

    assert created.status_code == 200
    assert replayed.status_code == 200
    assert replayed.json()["data"]["turns"] == payload["turns"]
    assert replayed.json()["data"]["version"] == 1


def test_put_agent_conversation_rejects_stale_version(auth_client):
    project = _create_project(auth_client)
    run = auth_client.post(
        "/workflow-runs",
        json=_payload(project["id"]),
    ).json()["data"]
    url = f"/workflow-runs/{run['id']}/agent-conversation"
    auth_client.put(
        url,
        json={"turns": _conversation_turns(), "schema_version": 2, "version": 0},
    )

    resp = auth_client.put(
        url,
        json={
            "turns": [{"role": "user", "content": "覆盖为旧数据"}],
            "schema_version": 2,
            "version": 0,
        },
    )

    assert resp.json()["code"] == 409
    assert "冲突" in resp.json()["message"]


def test_agent_conversation_is_hidden_from_other_users(auth_client, auth_client_b):
    project = _create_project(auth_client)
    run = auth_client.post(
        "/workflow-runs",
        json=_payload(project["id"]),
    ).json()["data"]
    url = f"/workflow-runs/{run['id']}/agent-conversation"

    assert auth_client_b.get(url).json()["code"] == 404
    assert (
        auth_client_b.put(
            url,
            json={"turns": _conversation_turns(), "schema_version": 2, "version": 0},
        ).json()["code"]
        == 404
    )


def test_agent_conversation_rejects_oversized_content(auth_client):
    project = _create_project(auth_client)
    run = auth_client.post(
        "/workflow-runs",
        json=_payload(project["id"]),
    ).json()["data"]

    resp = auth_client.put(
        f"/workflow-runs/{run['id']}/agent-conversation",
        json={
            "turns": [{"role": "user", "content": "x" * 8_001}],
            "schema_version": 2,
            "version": 0,
        },
    )

    assert resp.json()["code"] == 400


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
