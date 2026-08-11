"""生成任务 API 的认证与资源归属测试。"""

import asyncio

from windup_app.web.api.generation import _EventBus


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

    assert response.json()["code"] == 400
    assert response.json()["message"] == "接口待实现"


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

    assert response.json()["code"] == 400
    assert response.json()["message"] == "接口待实现"


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
