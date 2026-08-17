"""生成任务 API 的认证与资源归属测试。"""

import asyncio

import pytest
from sqlalchemy.orm import sessionmaker

from windup_app.web.api.generation import GenerationTaskOut, _EventBus

from conftest import seed_credit_account


@pytest.fixture(autouse=True)
def _gift_credits(engine):
    """提交生成任务会冻结积分，本文件用例都预置注册赠送账户。"""
    with sessionmaker(bind=engine)() as session:
        seed_credit_account(session, 1)
        seed_credit_account(session, 2)
        session.commit()


def _create_project(auth_client, name: str = "生成项目") -> dict:
    return auth_client.post(
        "/projects",
        json={
            "project_name": name,
            "character_perspective": 1,
            "directional_movement": 2,
            "sprite_width": 64,
            "sprite_height": 64,
        },
    ).json()["data"]


def _create_character(auth_client, project_id: int) -> dict:
    return auth_client.post(
        "/characters",
        json={
            "project_id": project_id,
            "workflow_run_id": 1,
            "name": "勇者",
        },
    ).json()["data"]


def _image_payload(project_id: int, **overrides) -> dict:
    payload = {
        "project_id": project_id,
        "prompt": "像素风勇者",
        "width": 64,
        "height": 64,
    }
    payload.update(overrides)
    return payload


def _action_payload(project_id: int, character_id: int, **overrides) -> dict:
    payload = {
        "project_id": project_id,
        "character_id": character_id,
        "action_type": "walk",
    }
    payload.update(overrides)
    return payload


def test_image_generation_uses_token_user_without_body_user_id(auth_client):
    project = _create_project(auth_client)

    response = auth_client.post(
        "/generation/image",
        json=_image_payload(project["id"]),
    )

    # 端点已接上服务层（本 PR），故断言真实行为：任务建成、归属取自 token 而不是请求体。
    body = response.json()
    assert body["data"] is not None, body
    assert body["data"]["status"] == "pending"


def test_spoofed_body_user_id_cannot_access_other_users_project(
    auth_client,
    auth_client_b,
):
    project = _create_project(auth_client)

    response = auth_client_b.post(
        "/generation/image",
        json=_image_payload(project["id"], user_id=1),
    )

    assert response.json()["code"] == 404
    assert response.json()["message"] == "项目不存在"


def test_action_generation_uses_token_user_without_body_user_id(auth_client):
    project = _create_project(auth_client)
    character = _create_character(auth_client, project["id"])

    response = auth_client.post(
        "/generation/action",
        json=_action_payload(project["id"], character["id"]),
    )

    # 端点已接上服务层（本 PR），故断言真实行为：任务建成、归属取自 token 而不是请求体。
    body = response.json()
    assert body["data"] is not None, body
    assert body["data"]["status"] == "pending"


def test_action_character_must_belong_to_requested_project(auth_client):
    first_project = _create_project(auth_client, "项目一")
    second_project = _create_project(auth_client, "项目二")
    character = _create_character(auth_client, first_project["id"])

    response = auth_client.post(
        "/generation/action",
        json=_action_payload(second_project["id"], character["id"]),
    )

    assert response.json()["code"] == 404
    assert response.json()["message"] == "角色不存在"


def test_task_query_checks_project_ownership(auth_client, auth_client_b):
    project = _create_project(auth_client)

    response = auth_client_b.get(
        "/generation/tasks/1",
        params={"project_id": project["id"]},
    )

    assert response.json()["code"] == 404
    assert response.json()["message"] == "项目不存在"


def test_task_stream_checks_project_ownership(auth_client, auth_client_b):
    project = _create_project(auth_client)

    response = auth_client_b.get(
        "/generation/tasks/1/stream",
        params={"project_id": project["id"]},
    )

    assert response.json()["code"] == 404
    assert response.json()["message"] == "项目不存在"


def test_event_bus_isolates_same_task_id_between_projects():
    async def scenario():
        bus = _EventBus()
        first_queue = await bus.subscribe(1, 9)
        second_queue = await bus.subscribe(2, 9)

        bus.publish(1, 9, "progress", {"status": "running"})

        assert first_queue.get_nowait() == (
            "progress",
            {"status": "running"},
        )
        assert second_queue.empty()

    asyncio.run(scenario())


def test_generation_response_contract_does_not_expose_user_id():
    assert "user_id" not in GenerationTaskOut.model_fields


# ── 端点必须真的接上服务层（2026-08-12 事故后补）──────────────────────────────
#
# 这三个端点曾在一次 rebase 里被换回 TODO 桩，CI 全绿、只有人工评审看出来。
# 根因是没有任何测试断言"端点会落库"—— 桩返回 400、测试也断言 400，两边一致。


def _submit_image(auth_client, project_id: int):
    return auth_client.post("/generation/image", json=_image_payload(project_id)).json()


def test_image_endpoint_actually_creates_a_task_row(auth_client):
    """提交后必须有一条 PENDING 任务落库，而不是抛"接口待实现"。"""
    project = _create_project(auth_client)
    body = _submit_image(auth_client, project["id"])
    assert body["data"] is not None, body
    task_id = body["data"]["id"]

    got = auth_client.get(f"/generation/tasks/{task_id}",
                          params={"project_id": project["id"]}).json()
    assert got["data"]["id"] == task_id
    assert got["data"]["status"] == "pending"


def test_action_endpoint_actually_creates_a_task_row(auth_client):
    project = _create_project(auth_client)
    character = _create_character(auth_client, project["id"])
    body = auth_client.post(
        "/generation/action",
        json=_action_payload(project["id"], character["id"]),
    ).json()
    assert body["data"] is not None, body
    assert body["data"]["status"] == "pending"


def test_task_query_rejects_a_task_from_another_project(auth_client):
    """归属两道：项目属于我 + 任务属于该项目。

    只查项目不够 —— 任意已认证用户拿自己的 project_id 配上别人的 task_id
    就能读到别人的产物 URL。用同一用户的两个项目复现，排除"项目校验挡住了"。
    """
    mine = _create_project(auth_client, "我的项目")
    other = _create_project(auth_client, "另一个项目")
    task_id = _submit_image(auth_client, other["id"])["data"]["id"]

    got = auth_client.get(f"/generation/tasks/{task_id}",
                          params={"project_id": mine["id"]}).json()
    assert got["data"] is None, got


def test_response_conversion_path_is_live(auth_client):
    """_task_to_out 必须真的被调用。

    它曾定义了没人调用 —— 那正是"整层没接上"的旁证之一。这里断言响应形状确实
    来自它（含 status / task_type 等领域字段），而不是随便一个 dict。
    """
    project = _create_project(auth_client)
    data = _submit_image(auth_client, project["id"])["data"]
    for k in ("id", "status", "task_type"):
        assert k in data, f"缺字段 {k}：{data}"
    assert "user_id" not in data, "响应不该暴露 user_id"


def test_validation_error_message_tells_the_user_what_is_wrong(auth_client):
    """校验失败的 message 必须是可读原因,不是一句笼统的"请求参数校验失败"。

    前端展示的是 message;把原因只塞进 data 等于用户永远看不到 —— 实测用户看到的是
    读不懂的"请求参数校验失败",而"custom 动作必须提供 custom_prompt"就在 data 里躺着。
    """
    project = _create_project(auth_client)
    r = auth_client.post("/generation/action", json={
        "project_id": project["id"], "character_id": 1,
        "action_type": "custom", "custom_prompt": "",
        "num_frames": 32, "reference_image_urls": ["https://media.windup.xin/x.png"],
    })
    body = r.json()
    assert body["code"] == 400
    assert body["message"] != "请求参数校验失败", "还是笼统文案,用户看不懂"
    assert "custom_prompt" in body["message"] or "动作" in body["message"]
    assert not body["message"].startswith("Value error,"), "pydantic 前缀是噪声,该剥掉"
