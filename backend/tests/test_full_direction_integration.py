"""八向生成从 HTTP 提交到 Worker、结果落库和结算的离线跨层回归。

Provider 边界使用记录型测试替身；本文件不替代真实 Provider 任务验收。
"""

from __future__ import annotations

import io

from PIL import Image
from sqlalchemy import select
from sqlalchemy.orm import sessionmaker

from conftest import seed_credit_account
from windup_ai_engine.ports import ActionQuality, GeneratedAction
from windup_app.server.orchestrator.executor import (
    ActionTaskExecutor,
    ImageTaskExecutor,
)
from windup_app.server.orchestrator.model import GenerationTaskRecord, TaskStatus
from windup_app.server.quota.model import CreditAccount
from windup_app.worker.handlers import handle_generation
from windup_common.directions import ActionDirection
from windup_common.models import CharacterStance
from windup_framework.config.quota import settings as quota_settings


def _frame() -> bytes:
    image = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
    image.paste((200, 60, 60, 255), (20, 8, 44, 60))
    buffer = io.BytesIO()
    image.save(buffer, "PNG")
    return buffer.getvalue()


class _RecordingGenerator:
    def __init__(self) -> None:
        self.calls: list[tuple[ActionDirection, CharacterStance]] = []

    def generate(self, card, action, master, progress, canvas=None):
        assert master
        assert canvas == (64, 64)
        self.calls.append((action.direction, card.stance))
        return GeneratedAction(
            frames=[_frame()],
            durations=[100],
            quality=ActionQuality(
                motion_scale=1.0,
                dead_frames=[],
                loop_seam=None,
                subject_blobs=(1,),
            ),
            prompt_version="integration-v1",
        )


class _RecordingImageProvider:
    def __init__(self) -> None:
        self.prompts: list[str] = []

    def gen_image(self, prompt, refs):
        assert refs == []
        self.prompts.append(prompt)
        return _frame()


class _IdentityMatte:
    def cutout(self, image):
        return image


def _create_eight_way_project(auth_client) -> dict:
    return auth_client.post(
        "/projects",
        json={
            "project_name": "八向集成项目",
            "character_perspective": 1,
            "directional_movement": 3,
            "sprite_width": 64,
            "sprite_height": 64,
        },
    ).json()["data"]


def test_eight_way_http_tasks_reach_worker_as_eight_real_results_and_settle_each_task(
    auth_client,
    db_session,
    engine,
    monkeypatch,
):
    directions = tuple(ActionDirection)
    initial_balance = quota_settings.generate_action_cost * len(directions) + 100
    seed_credit_account(db_session, 1, balance=initial_balance)
    db_session.commit()

    project = _create_eight_way_project(auth_client)
    character = auth_client.post(
        "/characters",
        json={
            "project_id": project["id"],
            "workflow_run_id": 1,
            "name": "八向勇者",
        },
    ).json()["data"]

    task_ids: list[int] = []
    for direction in directions:
        body = auth_client.post(
            "/generation/action",
            json={
                "project_id": project["id"],
                "character_id": character["id"],
                "action_type": "walk",
                "reference_image_urls": ["https://cdn.example.com/master.png"],
                "num_frames": 1,
                "stance": "quadruped",
                "direction": direction.value,
            },
        ).json()
        assert body["code"] == 200, body
        assert body["data"]["input_payload"]["direction"] == direction.value
        task_ids.append(body["data"]["id"])

    session_factory = sessionmaker(bind=engine, expire_on_commit=False)
    monkeypatch.setattr("windup_app.worker.handlers.SessionLocal", session_factory)
    generator = _RecordingGenerator()
    executor = ActionTaskExecutor(
        generator=generator,
        upload=lambda png: f"https://cdn.example.com/frame-{len(png)}.png",
        fetch_master=lambda _input: _frame(),
        session_factory=session_factory,
    )

    for task_id in task_ids:
        handle_generation(
            {"task_id": task_id, "task_type": "character_action"},
            run_image_task=lambda *_args: None,
            run_action_task=executor.run_action_task,
        )

    with session_factory() as session:
        tasks = session.scalars(
            select(GenerationTaskRecord)
            .where(GenerationTaskRecord.id.in_(task_ids))
            .order_by(GenerationTaskRecord.id)
        ).all()
        account = session.scalar(
            select(CreditAccount).where(CreditAccount.user_id == 1)
        )

        assert len(tasks) == len(directions)
        assert all(task.status == TaskStatus.COMPLETED.value for task in tasks)
        assert {task.result["direction"] for task in tasks} == {
            direction.value for direction in directions
        }
        assert account is not None
        assert account.frozen == 0
        assert account.total_spent == quota_settings.generate_action_cost * len(
            directions
        )
        assert account.balance == initial_balance - account.total_spent

    assert generator.calls == [
        (direction, CharacterStance.QUADRUPED) for direction in directions
    ]


def test_eight_way_image_tasks_call_provider_with_eight_direction_locks_and_settle_each_task(
    auth_client,
    db_session,
    engine,
    monkeypatch,
):
    directions = tuple(ActionDirection)
    initial_balance = quota_settings.generate_image_cost * len(directions) + 100
    seed_credit_account(db_session, 1, balance=initial_balance)
    db_session.commit()
    project = _create_eight_way_project(auth_client)

    task_ids: list[int] = []
    for direction in directions:
        body = auth_client.post(
            "/generation/image",
            json={
                "project_id": project["id"],
                "prompt": "像素风勇者",
                "width": 64,
                "height": 64,
                "num_images": 1,
                "direction": direction.value,
            },
        ).json()
        assert body["code"] == 200, body
        task_ids.append(body["data"]["id"])

    session_factory = sessionmaker(bind=engine, expire_on_commit=False)
    monkeypatch.setattr("windup_app.worker.handlers.SessionLocal", session_factory)
    provider = _RecordingImageProvider()
    executor = ImageTaskExecutor(
        image=provider,
        matte=_IdentityMatte(),
        upload=lambda png: f"https://cdn.example.com/image-{len(png)}.png",
        session_factory=session_factory,
    )

    for task_id in task_ids:
        handle_generation(
            {"task_id": task_id, "task_type": "character_image"},
            run_image_task=executor.run_image_task,
            run_action_task=lambda *_args: None,
        )

    with session_factory() as session:
        tasks = session.scalars(
            select(GenerationTaskRecord)
            .where(GenerationTaskRecord.id.in_(task_ids))
            .order_by(GenerationTaskRecord.id)
        ).all()
        account = session.scalar(
            select(CreditAccount).where(CreditAccount.user_id == 1)
        )

        assert all(task.status == TaskStatus.COMPLETED.value for task in tasks)
        assert {task.result["direction"] for task in tasks} == {
            direction.value for direction in directions
        }
        assert account is not None
        assert account.frozen == 0
        assert account.total_spent == quota_settings.generate_image_cost * len(
            directions
        )
        assert account.balance == initial_balance - account.total_spent

    assert len(provider.prompts) == len(directions)
    assert len(set(provider.prompts)) == len(directions)
    for direction, prompt in zip(directions, provider.prompts, strict=True):
        assert direction.value.replace("_", "-") in prompt.lower()
        assert "do not turn" in prompt.lower()
