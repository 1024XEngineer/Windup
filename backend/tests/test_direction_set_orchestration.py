"""方向集任务：单 task_id 编排、逐方向留存与局部重试。"""

from __future__ import annotations

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from windup_app.server.orchestrator.executor import DirectionSetTaskExecutor
from windup_app.server.orchestrator.model import (
    CharacterDirectionSetInput,
    GenerationType,
    TaskStatus,
)
from windup_app.server.orchestrator.service import AiGenerationService
from windup_app.server.quota.model import CreditAccount
from windup_app.worker import handlers
from windup_common.directions import ActionDirection
from windup_framework.config.quota import settings as quota_settings
from windup_framework.db.base import Base


_MASTER_URL = "https://cdn.example.com/masters/confirmed-east.png"


@pytest.fixture
def direction_session_factory():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, expire_on_commit=False)
    with factory() as session:
        session.add(
            CreditAccount(
                user_id=1,
                balance=1_000,
                frozen=0,
                total_earned=1_000,
                total_spent=0,
            )
        )
        session.commit()
    yield factory
    engine.dispose()


def _four_way_input() -> CharacterDirectionSetInput:
    return CharacterDirectionSetInput(
        character_id=42,
        reference_image_url=_MASTER_URL,
        prompt="像素风勇者",
        width=64,
        height=64,
        num_images=1,
        directions=[
            ActionDirection.EAST,
            ActionDirection.WEST,
            ActionDirection.NORTH,
            ActionDirection.SOUTH,
        ],
    )


def test_direction_set_submission_does_not_charge_for_confirmed_master(
    direction_session_factory,
):
    service = AiGenerationService()
    with direction_session_factory() as session:
        task = service.generate_character_direction_set(
            session,
            user_id=1,
            project_id=7,
            input=_four_way_input(),
        )
        account = session.scalar(
            select(CreditAccount).where(CreditAccount.user_id == 1)
        )

        assert task.task_type is GenerationType.CHARACTER_DIRECTION_SET
        assert task.input_payload["directions"] == [
            "east",
            "west",
            "north",
            "south",
        ]
        assert task.input_payload["billing_attempt"] == 0
        assert account.frozen == 3 * quota_settings.generate_image_cost


def test_direction_set_keeps_successes_and_only_retries_failed_direction(
    direction_session_factory,
):
    calls: list[ActionDirection] = []
    fail_north = True

    class _ImageExecutor:
        def _produce_image(self, input, _constraints):
            nonlocal fail_north
            if input.reference_image_url != _MASTER_URL:
                raise RuntimeError("direction generation lost confirmed master")
            calls.append(input.direction)
            if input.direction is ActionDirection.NORTH and fail_north:
                raise RuntimeError("north provider failed")
            return [f"https://cdn.example.com/{input.direction.value}.png"], {
                "subject_blobs": [1]
            }

    service = AiGenerationService()
    executor = DirectionSetTaskExecutor(
        image_executor=_ImageExecutor(),
        session_factory=direction_session_factory,
    )
    with direction_session_factory() as session:
        task = service.generate_character_direction_set(
            session,
            user_id=1,
            project_id=None,
            input=_four_way_input(),
        )
        session.commit()
        task_id = task.id

    executor.run_direction_set_task(task_id, _four_way_input())

    with direction_session_factory() as session:
        partial = service.get_task(session, project_id=0, task_id=task_id)
        account = session.scalar(
            select(CreditAccount).where(CreditAccount.user_id == 1)
        )
        assert partial.status is TaskStatus.PARTIAL
        by_direction = {item.direction: item for item in partial.result.directions}
        assert by_direction[ActionDirection.EAST].status == "completed"
        assert by_direction[ActionDirection.EAST].image_urls == [_MASTER_URL]
        assert by_direction[ActionDirection.NORTH].status == "failed"
        assert by_direction[ActionDirection.NORTH].image_urls == []
        assert account.frozen == 0
        assert account.total_spent == 2 * quota_settings.generate_image_cost

        retry = service.retry_failed_directions(session, task=partial)
        assert retry.status is TaskStatus.PENDING
        assert retry.input_payload["billing_attempt"] == 1
        session.commit()

    fail_north = False
    executor.run_direction_set_task(task_id, _four_way_input())

    with direction_session_factory() as session:
        done = service.get_task(session, project_id=0, task_id=task_id)
        account = session.scalar(
            select(CreditAccount).where(CreditAccount.user_id == 1)
        )

    assert done.status is TaskStatus.COMPLETED
    assert all(item.status == "completed" for item in done.result.directions)
    assert calls == [
        ActionDirection.WEST,
        ActionDirection.NORTH,
        ActionDirection.SOUTH,
        ActionDirection.NORTH,
    ]
    assert account.frozen == 0
    assert account.total_spent == 3 * quota_settings.generate_image_cost


def test_worker_dispatches_direction_set_to_aggregate_executor(
    direction_session_factory,
    monkeypatch,
):
    service = AiGenerationService()
    with direction_session_factory() as session:
        task = service.generate_character_direction_set(
            session,
            user_id=1,
            project_id=9,
            input=_four_way_input(),
        )
        session.commit()
        task_id = task.id

    seen: list[tuple[int, CharacterDirectionSetInput, int]] = []
    monkeypatch.setattr(handlers, "SessionLocal", direction_session_factory)
    handlers.handle_generation(
        {"task_id": task_id, "task_type": "character_direction_set"},
        run_image_task=lambda *_args: pytest.fail("不应走单方向图片执行器"),
        run_action_task=lambda *_args: pytest.fail("不应走动作执行器"),
        run_direction_set_task=lambda *args: seen.append(args),
    )

    assert seen[0][0] == task_id
    assert seen[0][1].directions == _four_way_input().directions
    assert seen[0][2] == 9


def test_direction_set_settlement_uses_frozen_price_not_current_price(
    direction_session_factory,
    monkeypatch,
):
    initial_price = quota_settings.generate_image_cost

    class _ImageExecutor:
        def _produce_image(self, input, _constraints):
            if input.reference_image_url != _MASTER_URL:
                raise RuntimeError("direction generation lost confirmed master")
            return [f"https://cdn.example.com/{input.direction.value}.png"], None

    service = AiGenerationService()
    with direction_session_factory() as session:
        task = service.generate_character_direction_set(
            session,
            user_id=1,
            project_id=None,
            input=_four_way_input(),
        )
        session.commit()
        task_id = task.id

    monkeypatch.setattr(quota_settings, "generate_image_cost", initial_price + 7)
    DirectionSetTaskExecutor(
        image_executor=_ImageExecutor(),
        session_factory=direction_session_factory,
    ).run_direction_set_task(task_id, _four_way_input())

    with direction_session_factory() as session:
        account = session.scalar(
            select(CreditAccount).where(CreditAccount.user_id == 1)
        )

    assert account.total_spent == 3 * initial_price
