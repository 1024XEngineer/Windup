"""四向 / 八向立绘 sheet：提交任务类型与预付费次数。"""

from __future__ import annotations

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from windup_app.server.orchestrator.model import (
    CharacterViewSheetInput,
    GenerationType,
)
from windup_app.server.orchestrator.service import AiGenerationService
from windup_app.server.quota.model import CreditAccount
from windup_framework.config.quota import settings as quota_settings
from windup_framework.db.base import Base


_MASTER_URL = "https://cdn.example.com/masters/confirmed-east.png"


@pytest.fixture
def sheet_session_factory():
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


def _sheet_input() -> CharacterViewSheetInput:
    return CharacterViewSheetInput(
        character_id=42,
        reference_image_url=_MASTER_URL,
        prompt="像素风勇者",
        width=64,
        height=96,
    )


def test_four_view_submission_charges_two_calls_and_reuses_master(sheet_session_factory):
    service = AiGenerationService()
    with sheet_session_factory() as session:
        task = service.generate_character_four_view(
            session, user_id=1, project_id=7, input=_sheet_input(),
        )
        account = session.scalar(
            select(CreditAccount).where(CreditAccount.user_id == 1)
        )

    assert task.task_type is GenerationType.CHARACTER_FOUR_VIEW
    assert task.input_payload["reference_image_url"] == _MASTER_URL
    assert task.input_payload["anchor_direction"] == "south"
    assert task.input_payload["num_images"] == 1
    assert account.frozen == 2 * quota_settings.generate_image_cost


def test_eight_view_submission_charges_four_calls(sheet_session_factory):
    service = AiGenerationService()
    with sheet_session_factory() as session:
        task = service.generate_character_eight_view(
            session, user_id=1, project_id=7, input=_sheet_input(),
        )
        account = session.scalar(
            select(CreditAccount).where(CreditAccount.user_id == 1)
        )

    assert task.task_type is GenerationType.CHARACTER_EIGHT_VIEW
    assert account.frozen == 4 * quota_settings.generate_image_cost


def test_view_sheet_input_rejects_blank_master():
    with pytest.raises(ValueError, match="已确认角色母版"):
        CharacterViewSheetInput(character_id=1, reference_image_url="  ")


def test_view_sheet_anchor_must_be_south_front_view():
    from windup_common.directions import ActionDirection

    with pytest.raises(ValueError, match="south"):
        CharacterViewSheetInput(
            character_id=1,
            reference_image_url=_MASTER_URL,
            anchor_direction=ActionDirection.EAST,
        )


def test_view_sheet_cell_requires_uploaded_url_even_for_mirror():
    from windup_app.server.orchestrator.model import CharacterViewSheetCell
    from windup_common.directions import ActionDirection

    west = CharacterViewSheetCell(
        direction=ActionDirection.WEST,
        image_url="https://cdn.example.com/west.png",
        source_direction=ActionDirection.EAST,
        mirror_x=True,
    )
    assert west.image_url.endswith("west.png")
    with pytest.raises(ValueError, match="image_url"):
        CharacterViewSheetCell(
            direction=ActionDirection.WEST,
            image_url="  ",
            source_direction=ActionDirection.EAST,
            mirror_x=True,
        )


def test_worker_dispatches_four_view_to_sheet_executor_not_image(
    sheet_session_factory,
    monkeypatch,
):
    from windup_app.worker import handlers

    service = AiGenerationService()
    with sheet_session_factory() as session:
        task = service.generate_character_four_view(
            session, user_id=1, project_id=9, input=_sheet_input(),
        )
        session.commit()
        task_id = task.id

    seen: list[tuple] = []
    monkeypatch.setattr(handlers, "SessionLocal", sheet_session_factory)
    handlers.handle_generation(
        {"task_id": task_id, "task_type": "character_four_view"},
        run_image_task=lambda *_args: pytest.fail("不应走单张立绘执行器"),
        run_action_task=lambda *_args: pytest.fail("不应走动作执行器"),
        run_direction_set_task=lambda *_args: pytest.fail("不应走方向集执行器"),
        run_view_sheet_task=lambda *args: seen.append(args),
    )

    assert seen[0][0] == task_id
    assert seen[0][1].character_id == 42
    assert seen[0][1].reference_image_url == _MASTER_URL
    assert seen[0][1].anchor_direction.value == "south"
    assert seen[0][2] is GenerationType.CHARACTER_FOUR_VIEW
    assert seen[0][3] == 9
