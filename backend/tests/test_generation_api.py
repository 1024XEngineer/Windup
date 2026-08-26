"""生成任务 API 的认证与资源归属测试。"""

import asyncio

import pytest
from sqlalchemy import select
from sqlalchemy.orm import sessionmaker

from windup_app.server.quota.model import CreditAccount
from windup_app.web.api.generation import GenerationTaskOut, _EventBus

from conftest import seed_credit_account


@pytest.fixture(autouse=True)
def _gift_credits(engine):
    """提交生成任务会冻结积分，本文件用例都预置注册赠送账户。"""
    with sessionmaker(bind=engine)() as session:
        seed_credit_account(session, 1)
        seed_credit_account(session, 2)
        session.commit()


def _create_project(
    auth_client, name: str = "生成项目", directional_movement: int = 2
) -> dict:
    return auth_client.post(
        "/projects",
        json={
            "project_name": name,
            "character_perspective": 1,
            "directional_movement": directional_movement,
            "sprite_width": 64,
            "sprite_height": 64,
        },
    ).json()["data"]


def _create_character(
    auth_client,
    project_id: int,
    *,
    reference_image_url: str | None = None,
) -> dict:
    return auth_client.post(
        "/characters",
        json={
            "project_id": project_id,
            "workflow_run_id": 1,
            "name": "勇者",
            "reference_image_url": reference_image_url,
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


def _direction_set_payload(project_id: int, character_id: int, **overrides) -> dict:
    payload = _image_payload(project_id, character_id=character_id)
    payload.update(overrides)
    return payload


_MASTER_URL = "https://cdn.example.com/masters/hero.png"


def _action_payload(project_id: int, character_id: int, **overrides) -> dict:
    # 母版是提交动作生成的前置条件(见 _require_master),缺了它整条请求都进不去,
    # 所以默认带上;要测"缺母版"的用例显式覆盖成空。
    payload = {
        "project_id": project_id,
        "character_id": character_id,
        "action_type": "walk",
        "reference_image_urls": [_MASTER_URL],
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


def test_image_generation_rejects_west_for_four_way_project(auth_client):
    project = _create_project(auth_client)

    body = auth_client.post(
        "/generation/image",
        json=_image_payload(project["id"], direction="west"),
    ).json()

    assert body["code"] == 400
    assert "west" in body["message"]


def test_action_generation_rejects_west_for_four_way_project(auth_client):
    project = _create_project(auth_client)
    character = _create_character(auth_client, project["id"])

    body = auth_client.post(
        "/generation/action",
        json=_action_payload(project["id"], character["id"], direction="west"),
    ).json()

    assert body["code"] == 400
    assert "west" in body["message"]


def test_image_generation_rejects_north_west_for_eight_way_project(auth_client):
    project = _create_project(
        auth_client,
        name="八向生成项目",
        directional_movement=3,
    )

    body = auth_client.post(
        "/generation/image",
        json=_image_payload(project["id"], direction="north_west"),
    ).json()

    assert body["code"] == 400
    assert "north_west" in body["message"]


def test_direction_set_generation_derives_all_directions_from_project(auth_client):
    project = _create_project(
        auth_client,
        name="八向方向集项目",
        directional_movement=3,
    )
    character = _create_character(
        auth_client,
        project["id"],
        reference_image_url=_MASTER_URL,
    )

    body = auth_client.post(
        "/generation/image-set",
        json=_direction_set_payload(project["id"], character["id"], num_images=1),
    ).json()

    assert body["code"] == 200
    assert body["data"]["task_type"] == "character_direction_set"
    assert body["data"]["status"] == "pending"
    assert body["data"]["input_payload"]["character_id"] == character["id"]
    assert body["data"]["input_payload"]["reference_image_url"] == _MASTER_URL
    assert body["data"]["input_payload"]["directions"] == [
        "east",
        "north",
        "south",
        "north_east",
        "south_east",
    ]


def test_direction_set_without_confirmed_master_is_rejected_before_queueing(auth_client):
    project = _create_project(auth_client)
    character = _create_character(auth_client, project["id"])
    publisher = auth_client.app.state.mq_publisher
    publisher.reset_mock()

    response = auth_client.post(
        "/generation/image-set",
        json=_direction_set_payload(project["id"], character["id"], num_images=1),
    )

    assert response.json()["code"] == 400
    assert "请先选择并确认角色母版" in response.json()["message"]
    publisher.enqueue.assert_not_called()


def test_single_direction_set_reuses_master_without_queueing_or_charging(
    auth_client,
    engine,
):
    project = _create_project(
        auth_client,
        name="单向项目",
        directional_movement=1,
    )
    character = _create_character(
        auth_client,
        project["id"],
        reference_image_url=_MASTER_URL,
    )
    publisher = auth_client.app.state.mq_publisher
    publisher.reset_mock()

    response = auth_client.post(
        "/generation/image-set",
        json=_direction_set_payload(project["id"], character["id"], num_images=1),
    ).json()

    with sessionmaker(bind=engine)() as session:
        account = session.scalar(
            select(CreditAccount).where(CreditAccount.user_id == 1)
        )

    assert response["code"] == 200
    assert response["data"]["status"] == "completed"
    assert response["data"]["result"]["directions"] == [
        {
            "direction": "east",
            "status": "completed",
            "image_urls": [_MASTER_URL],
            "quality": None,
            "error_message": None,
        }
    ]
    assert account.frozen == 0
    assert account.total_spent == 0
    publisher.enqueue.assert_not_called()


def test_direction_set_retry_rejects_task_that_has_not_partially_failed(auth_client):
    project = _create_project(auth_client)
    character = _create_character(
        auth_client,
        project["id"],
        reference_image_url=_MASTER_URL,
    )
    submitted = auth_client.post(
        "/generation/image-set",
        json=_direction_set_payload(project["id"], character["id"], num_images=1),
    ).json()["data"]

    response = auth_client.post(
        f"/generation/tasks/{submitted['id']}/retry-failed-directions",
        params={"project_id": project["id"]},
    )

    assert response.json()["code"] == 400
    assert "部分失败" in response.json()["message"]


def test_direction_set_retry_publishes_a_new_attempt_message(auth_client, engine):
    from windup_app.server.orchestrator import billing, task_repo
    from windup_app.server.orchestrator.model import TaskStatus
    from windup_framework.config.quota import settings as quota_settings

    project = _create_project(auth_client)
    character = _create_character(
        auth_client,
        project["id"],
        reference_image_url=_MASTER_URL,
    )
    submitted = auth_client.post(
        "/generation/image-set",
        json=_direction_set_payload(project["id"], character["id"], num_images=1),
    ).json()["data"]
    with sessionmaker(bind=engine)() as session:
        task_repo.update_progress(
            session,
            submitted["id"],
            "character_direction_set",
            {
                "type": "character_direction_set",
                "directions": [
                    {"direction": "east", "status": "completed", "image_urls": ["east"]},
                    {"direction": "west", "status": "completed", "image_urls": ["west"]},
                    {"direction": "north", "status": "failed", "image_urls": []},
                    {"direction": "south", "status": "completed", "image_urls": ["south"]},
                ],
            },
            status=TaskStatus.PARTIAL,
        )
        billing.capture_for_task(
            session,
            user_id=1,
            task_id=submitted["id"],
            actual_amount=2 * quota_settings.generate_image_cost,
        )
        session.commit()

    publisher = auth_client.app.state.mq_publisher
    publisher.reset_mock()
    response = auth_client.post(
        f"/generation/tasks/{submitted['id']}/retry-failed-directions",
        params={"project_id": project["id"]},
    )

    data = response.json()["data"]
    assert data["status"] == "pending"
    assert data["input_payload"]["billing_attempt"] == 1
    assert publisher.enqueue.call_args.kwargs["dedupe_key"] == (
        f"generation:{submitted['id']}:retry:1"
    )


def _view_sheet_payload(project_id: int, character_id: int, **overrides) -> dict:
    payload = {
        "project_id": project_id,
        "character_id": character_id,
        "width": 64,
        "height": 64,
    }
    payload.update(overrides)
    return payload


def test_four_view_copies_confirmed_master_and_shares_image_queue(auth_client):
    project = _create_project(auth_client)
    character = _create_character(
        auth_client,
        project["id"],
        reference_image_url=_MASTER_URL,
    )
    publisher = auth_client.app.state.mq_publisher
    publisher.reset_mock()

    body = auth_client.post(
        "/generation/four-view",
        json=_view_sheet_payload(project["id"], character["id"]),
    ).json()

    assert body["code"] == 200
    assert body["data"]["task_type"] == "character_four_view"
    assert body["data"]["status"] == "pending"
    assert body["data"]["input_payload"]["reference_image_url"] == _MASTER_URL
    assert body["data"]["input_payload"]["anchor_direction"] == "south"
    assert body["data"]["input_payload"]["num_images"] == 1
    assert "direction" not in body["data"]["input_payload"]
    assert publisher.enqueue.call_args.kwargs["msg_type"] == "character_image"
    assert publisher.enqueue.call_args.kwargs["payload"]["task_type"] == "character_four_view"


def test_four_view_without_confirmed_master_is_rejected_before_queueing(auth_client):
    project = _create_project(auth_client)
    character = _create_character(auth_client, project["id"])
    publisher = auth_client.app.state.mq_publisher
    publisher.reset_mock()

    response = auth_client.post(
        "/generation/four-view",
        json=_view_sheet_payload(project["id"], character["id"]),
    )

    assert response.json()["code"] == 400
    assert "请先选择并确认角色母版" in response.json()["message"]
    publisher.enqueue.assert_not_called()


def test_four_view_rejects_unidirectional_project(auth_client):
    project = _create_project(auth_client, name="单向", directional_movement=1)
    character = _create_character(
        auth_client, project["id"], reference_image_url=_MASTER_URL,
    )
    publisher = auth_client.app.state.mq_publisher
    publisher.reset_mock()

    response = auth_client.post(
        "/generation/four-view",
        json=_view_sheet_payload(project["id"], character["id"]),
    )

    assert response.json()["code"] == 400
    assert "当前项目不是四向" in response.json()["message"]
    publisher.enqueue.assert_not_called()


def test_eight_view_rejects_four_way_project(auth_client):
    project = _create_project(auth_client)
    character = _create_character(
        auth_client, project["id"], reference_image_url=_MASTER_URL,
    )

    response = auth_client.post(
        "/generation/eight-view",
        json=_view_sheet_payload(project["id"], character["id"]),
    )

    assert response.json()["code"] == 400
    assert "当前项目不是八向" in response.json()["message"]


def test_eight_view_submits_on_eight_way_project(auth_client):
    project = _create_project(
        auth_client, name="八向 sheet", directional_movement=3,
    )
    character = _create_character(
        auth_client, project["id"], reference_image_url=_MASTER_URL,
    )

    body = auth_client.post(
        "/generation/eight-view",
        json=_view_sheet_payload(project["id"], character["id"]),
    ).json()

    assert body["code"] == 200
    assert body["data"]["task_type"] == "character_eight_view"
    assert body["data"]["input_payload"]["anchor_direction"] == "south"


def test_view_sheet_rejects_client_supplied_reference_url(auth_client):
    project = _create_project(auth_client)
    character = _create_character(
        auth_client, project["id"], reference_image_url=_MASTER_URL,
    )

    publisher = auth_client.app.state.mq_publisher
    publisher.reset_mock()
    response = auth_client.post(
        "/generation/four-view",
        json=_view_sheet_payload(
            project["id"],
            character["id"],
            reference_image_url="https://evil.example/not-the-master.png",
        ),
    )

    body = response.json()
    assert body["code"] == 400
    assert "reference_image_url" in body["message"] or "Extra" in body["message"]
    publisher.enqueue.assert_not_called()


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

    got = auth_client.get(
        f"/generation/tasks/{task_id}", params={"project_id": project["id"]}
    ).json()
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

    got = auth_client.get(
        f"/generation/tasks/{task_id}", params={"project_id": mine["id"]}
    ).json()
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
    r = auth_client.post(
        "/generation/action",
        json={
            "project_id": project["id"],
            "character_id": 1,
            "action_type": "custom",
            "custom_prompt": "",
            "num_frames": 32,
            "reference_image_urls": ["https://media.windup.xin/x.png"],
        },
    )
    body = r.json()
    assert body["code"] == 400
    assert body["message"] != "请求参数校验失败", "还是笼统文案,用户看不懂"
    assert "custom_prompt" in body["message"] or "动作" in body["message"]
    assert not body["message"].startswith("Value error,"), "pydantic 前缀是噪声,该剥掉"

# ── 缺母版必须在提交时就拒收 ───────────────────────────────────────────────
#
# 曾经是：提交返 200、任务 pending，直到执行阶段 _download_master 才抛
# "缺少母版:reference_image_urls 为空"。用户看到的是任务莫名其妙 failed，
# 错误还是句写给后端看的话。


def _capture_dispatch(monkeypatch) -> list:
    """接管派发，用来断言"这个任务压根没被收下"，而不只是响应体不好看。"""
    from windup_app.web.api import generation as gen_api

    return _capture_action_input(gen_api, monkeypatch)


def test_action_without_master_is_rejected_at_submission(auth_client, monkeypatch):
    project = _create_project(auth_client)
    character = _create_character(auth_client, project["id"])
    dispatched = _capture_dispatch(monkeypatch)

    body = auth_client.post(
        "/generation/action",
        json=_action_payload(project["id"], character["id"], reference_image_urls=[]),
    ).json()

    assert body["code"] == 400, body
    assert body["data"] is None, body
    # 消息要告诉用户下一步做什么，不是复述内部字段名。
    assert "定妆" in body["message"], body["message"]
    assert not dispatched, "缺母版的任务不该被收下并排队"


def test_action_with_only_blank_master_urls_is_rejected(auth_client, monkeypatch):
    """空白串不算母版——判定口径必须和执行器取 reference_image_urls[0] 一致。"""
    project = _create_project(auth_client)
    character = _create_character(auth_client, project["id"])
    dispatched = _capture_dispatch(monkeypatch)

    body = auth_client.post(
        "/generation/action",
        json=_action_payload(project["id"], character["id"], reference_image_urls=["", "   "]),
    ).json()

    assert body["code"] == 400, body
    assert not dispatched


def test_blank_master_urls_never_reach_the_executor(auth_client, monkeypatch):
    """混着空白串提交时，落到任务入参上的必须是干净的那一条。"""
    from windup_app.server.orchestrator.model import CharacterActionInput

    project = _create_project(auth_client)
    character = _create_character(auth_client, project["id"])
    dispatched = _capture_dispatch(monkeypatch)

    auth_client.post(
        "/generation/action",
        json=_action_payload(
            project["id"], character["id"], reference_image_urls=["  ", _MASTER_URL],
        ),
    )

    inputs = [a for args in dispatched for a in args if isinstance(a, CharacterActionInput)]
    assert inputs and inputs[0].reference_image_urls == [_MASTER_URL]


def test_custom_action_without_prompt_is_rejected(auth_client, monkeypatch):
    """最后一道防线也要有人断言它还在。

    前端已经在提交前拦了空描述，但这道是它漏掉时唯一的兜底；本仓有过"校验被 rebase
    换回桩、CI 全绿"的先例，没测试断言的防线等于没有。
    """
    project = _create_project(auth_client)
    character = _create_character(auth_client, project["id"])
    dispatched = _capture_dispatch(monkeypatch)

    body = auth_client.post(
        "/generation/action",
        json=_action_payload(
            project["id"], character["id"], action_type="custom", custom_prompt="   ",
        ),
    ).json()

    assert body["code"] == 400, body
    assert not dispatched


def test_action_with_3d_outfit_is_accepted_without_reference_images(auth_client):
    """三渲二路线的母版是绑骨模型，没有 raster 母版可言，不该被这道预检误伤。"""
    project = _create_project(auth_client)
    character = auth_client.post(
        "/characters",
        json={
            "project_id": project["id"],
            "workflow_run_id": 1,
            "name": "勇者",
            "character_data": {
                "version": 1,
                "outfits": [{
                    "id": "outfit-3d",
                    "name": "汉服",
                    "model_3d_url": "https://cdn.example.com/outfits/hanfu.glb",
                    "actions": [],
                }],
            },
        },
    ).json()["data"]

    body = auth_client.post(
        "/generation/action",
        json=_action_payload(
            project["id"], character["id"],
            reference_image_urls=[],
            outfit_id="outfit-3d",
        ),
    ).json()

    assert body["data"] is not None, body
    assert body["data"]["status"] == "pending"


# ── 体型必须从 HTTP 入口一路传到 CharacterCard ─────────────────────────────
#
# 只在 ai_engine 侧加门禁不够:生产链路恒走 CharacterCard 的 BIPED 默认值,四足角色
# 永远触发不了它。这条测试从真实端点发起,断言的是"贯通"而不是"函数会不会算"。


def _capture_action_input(gen_api, monkeypatch) -> list:
    """截下建任务时的引擎入参。

    挂在建任务这一步而不是投递那一步:投递只带 task_id,看不到入参,而这两条用例
    要断言的正是"字段有没有从请求一路走到引擎入参"。
    """
    seen: list = []
    real = gen_api.generation_service.generate_character_action

    def spy(*args, **kwargs):
        seen.append((kwargs.get("input"),))
        return real(*args, **kwargs)

    monkeypatch.setattr(gen_api.generation_service, "generate_character_action", spy)
    return seen


def test_stance_from_request_reaches_the_engine(auth_client, monkeypatch):
    from windup_app.web.api import generation as gen_api
    from windup_app.server.orchestrator.model import CharacterActionInput

    dispatched = _capture_action_input(gen_api, monkeypatch)
    project = _create_project(auth_client)
    character = _create_character(auth_client, project["id"])

    auth_client.post(
        "/generation/action",
        json=_action_payload(project["id"], character["id"], stance="quadruped"),
    )

    inputs = [a for args in dispatched for a in args if isinstance(a, CharacterActionInput)]
    assert inputs, "任务没被收下"
    assert inputs[0].stance is not None, "体型断在请求层,引擎侧永远看不到"
    assert inputs[0].stance.value == "quadruped"


def test_stance_omitted_stays_none_not_biped(auth_client, monkeypatch):
    """不给体型时原样传 None —— 在这层替调用方填 biped，"没给"与"明确双足"就分不开了。"""
    from windup_app.web.api import generation as gen_api
    from windup_app.server.orchestrator.model import CharacterActionInput

    dispatched = _capture_action_input(gen_api, monkeypatch)
    project = _create_project(auth_client)
    character = _create_character(auth_client, project["id"])

    auth_client.post(
        "/generation/action", json=_action_payload(project["id"], character["id"]),
    )

    inputs = [a for args in dispatched for a in args if isinstance(a, CharacterActionInput)]
    assert inputs and inputs[0].stance is None


def test_ground_contact_from_request_reaches_the_task_input(auth_client, monkeypatch):
    """飞 / 游 / 攀的声明断在请求层的话,对齐那一步永远走脚线分支(#534)。"""
    from windup_app.web.api import generation as gen_api
    from windup_app.server.orchestrator.model import CharacterActionInput

    dispatched = _capture_action_input(gen_api, monkeypatch)
    project = _create_project(auth_client)
    character = _create_character(auth_client, project["id"])

    auth_client.post(
        "/generation/action",
        json=_action_payload(
            project["id"], character["id"],
            action_type="custom", custom_prompt="flies forward", ground_contact=False,
        ),
    )

    inputs = [a for args in dispatched for a in args if isinstance(a, CharacterActionInput)]
    assert inputs, "任务没被收下"
    assert inputs[0].ground_contact is False


def test_ground_contact_omitted_stays_none_not_true(auth_client, monkeypatch):
    """不给就原样传 None —— 在这层填默认值,"没给"与"明确有地面接触"就分不开了。"""
    from windup_app.web.api import generation as gen_api
    from windup_app.server.orchestrator.model import CharacterActionInput

    dispatched = _capture_action_input(gen_api, monkeypatch)
    project = _create_project(auth_client)
    character = _create_character(auth_client, project["id"])

    auth_client.post(
        "/generation/action", json=_action_payload(project["id"], character["id"]),
    )

    inputs = [a for args in dispatched for a in args if isinstance(a, CharacterActionInput)]
    assert inputs and inputs[0].ground_contact is None


def test_ground_contact_on_a_fixed_action_is_rejected_at_the_entrance(auth_client):
    """walk 收下这个字段等于让调用方以为自己能改它,而它不会生效。"""
    project = _create_project(auth_client)
    character = _create_character(auth_client, project["id"])
    body = auth_client.post(
        "/generation/action",
        json=_action_payload(project["id"], character["id"], ground_contact=False),
    ).json()
    assert body["code"] == 400, body
    assert "ground_contact" in body["message"], body["message"]


def test_illegal_stance_is_rejected_at_the_entrance(auth_client):
    project = _create_project(auth_client)
    character = _create_character(auth_client, project["id"])
    body = auth_client.post(
        "/generation/action",
        json=_action_payload(project["id"], character["id"], stance="octopod"),
    ).json()
    assert body["code"] == 400, body


# ── 帧数按动作类型取,且只有一份约定 ────────────────────────────────────────
#
# 32 曾同时是后端默认值和前端"这是完整动画任务"的判据,于是改一个动作的帧数会让
# 前端认不出这类任务。现在约定只在 ACTION_FRAME_COUNTS 一处,前端提交时不发帧数。


def test_idle_task_frames_come_from_the_convention(auth_client):
    """待机任务落库的帧数取该动作类型的约定值。

    断言的是任务 input_payload —— 前端与 MQ 重建都从它读帧数,只断言函数返回值的话,
    请求层没接上也照样绿。
    """
    from windup_app.server.orchestrator.model import ActionType, frames_for

    project = _create_project(auth_client)
    character = _create_character(auth_client, project["id"])

    body = auth_client.post(
        "/generation/action",
        json=_action_payload(project["id"], character["id"], action_type="idle"),
    ).json()

    assert body["data"] is not None, body
    stored = body["data"]["input_payload"]["num_frames"]
    assert stored == frames_for(ActionType.IDLE)
    assert stored != 32, "待机还在按 32 帧生成"


def test_walk_task_keeps_thirty_two_frames(auth_client):
    """本改动只动待机;走路的帧数不变。"""
    project = _create_project(auth_client)
    character = _create_character(auth_client, project["id"])

    body = auth_client.post(
        "/generation/action",
        json=_action_payload(project["id"], character["id"], action_type="walk"),
    ).json()

    assert body["data"]["input_payload"]["num_frames"] == 32


def test_explicit_num_frames_wins_over_the_convention(auth_client):
    project = _create_project(auth_client)
    character = _create_character(auth_client, project["id"])

    body = auth_client.post(
        "/generation/action",
        json=_action_payload(
            project["id"], character["id"], action_type="idle", num_frames=20,
        ),
    ).json()

    assert body["data"]["input_payload"]["num_frames"] == 20


def test_frame_convention_covers_every_action_type():
    """新增动作类型必须同时给出帧数 —— 漏了的话取帧数会在请求里抛 KeyError。"""
    from windup_app.server.orchestrator.model import ACTION_FRAME_COUNTS, ActionType

    assert set(ACTION_FRAME_COUNTS) == set(ActionType)
