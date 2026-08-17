"""生成任务调度必须走预付费冻结 / 扣减 / 解冻。"""

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from windup_framework.db.base import Base
from windup_app.server.orchestrator import billing
from windup_app.server.orchestrator.executor import ActionTaskExecutor, ImageTaskExecutor
from windup_app.server.orchestrator.model import (
    ActionType,
    CharacterActionInput,
    CharacterImageInput,
    GenerationTaskRecord,
    GenerationType,
    TaskStatus,
)
from windup_app.server.orchestrator.service import AiGenerationService
from windup_app.server.quota.model import CreditAccount, CreditTransaction
from windup_common.enums.quota import CreditReason
from windup_common.exceptions import BizException
from windup_framework.config.quota import settings as quota_settings

from conftest import seed_credit_account
from test_generation_orchestration import _SpyGenerator, _tiny_png


@pytest.fixture
def session_factory():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine)


def _seed_account(session: Session, user_id: int, *, balance: int | None = None) -> CreditAccount:
    return seed_credit_account(session, user_id, balance=balance)


def _account(session: Session, user_id: int) -> CreditAccount:
    return session.scalar(select(CreditAccount).where(CreditAccount.user_id == user_id))


def _reasons(session: Session, user_id: int) -> list[int]:
    rows = session.scalars(
        select(CreditTransaction)
        .where(CreditTransaction.user_id == user_id)
        .order_by(CreditTransaction.id)
    ).all()
    return [row.reason for row in rows]


def test_submit_image_generation_reserves_prepaid_credit(auth_client, db_session):
    _seed_account(db_session, 1)
    db_session.commit()

    project = auth_client.post(
        "/projects",
        json={
            "project_name": "积分项目",
            "character_perspective": 1,
            "directional_movement": 2,
            "sprite_width": 64,
            "sprite_height": 64,
        },
    ).json()["data"]

    response = auth_client.post(
        "/generation/image",
        json={"project_id": project["id"], "prompt": "勇者", "width": 64, "height": 64},
    )
    body = response.json()
    assert body["data"] is not None, body
    task_id = body["data"]["id"]

    account = _account(db_session, 1)
    db_session.refresh(account)
    assert account.frozen == quota_settings.generate_image_cost
    assert account.balance == quota_settings.register_gift_amount - quota_settings.generate_image_cost
    assert _reasons(db_session, 1) == [CreditReason.FROZEN]
    txn = db_session.scalar(select(CreditTransaction).where(CreditTransaction.user_id == 1))
    assert txn.ref_id == f"task:{task_id}"


def test_submit_rejects_when_credit_is_insufficient(auth_client, db_session):
    _seed_account(db_session, 1, balance=1)
    db_session.commit()

    project = auth_client.post(
        "/projects",
        json={
            "project_name": "没钱项目",
            "character_perspective": 1,
            "directional_movement": 2,
            "sprite_width": 64,
            "sprite_height": 64,
        },
    ).json()["data"]

    response = auth_client.post(
        "/generation/image",
        json={"project_id": project["id"], "prompt": "勇者", "width": 64, "height": 64},
    )
    body = response.json()
    assert body["code"] == 400
    assert "积分不足" in body["message"]

    account = _account(db_session, 1)
    db_session.refresh(account)
    assert account.balance == 1
    assert account.frozen == 0
    assert db_session.scalar(select(CreditTransaction).where(CreditTransaction.user_id == 1)) is None


def test_action_success_captures_reserved_credit(session_factory):
    with session_factory() as session:
        _seed_account(session, 1)
        session.commit()

    service = AiGenerationService()
    executor = ActionTaskExecutor(
        generator=_SpyGenerator(),
        upload=lambda _png: "https://cdn.example.com/f.png",
        fetch_master=lambda _input: _tiny_png(),
        session_factory=session_factory,
    )
    action_input = CharacterActionInput(
        character_id=1, action_type=ActionType.WALK, num_frames=2,
    )
    with session_factory() as session:
        task = service.generate_character_action(session, user_id=1, input=action_input)
        session.commit()
        task_id = task.id

    executor.run_action_task(task_id, action_input)

    with session_factory() as session:
        done = service.get_task(session, project_id=1, task_id=task_id)
        account = _account(session, 1)
        assert done.status is TaskStatus.COMPLETED
        assert account.frozen == 0
        assert account.total_spent == quota_settings.generate_action_cost
        assert account.balance == quota_settings.register_gift_amount - quota_settings.generate_action_cost
        assert CreditReason.CAPTURED in _reasons(session, 1)


def test_action_failure_releases_reserved_credit(session_factory):
    with session_factory() as session:
        _seed_account(session, 1)
        session.commit()

    service = AiGenerationService()
    def _boom(_input):
        raise RuntimeError("母版下载失败")

    executor = ActionTaskExecutor(
        generator=None,
        fetch_master=_boom,
        session_factory=session_factory,
    )
    action_input = CharacterActionInput(
        character_id=1, action_type=ActionType.WALK, num_frames=2,
    )
    with session_factory() as session:
        task = service.generate_character_action(session, user_id=1, input=action_input)
        session.commit()
        task_id = task.id

    executor.run_action_task(task_id, action_input)

    with session_factory() as session:
        done = service.get_task(session, project_id=1, task_id=task_id)
        account = _account(session, 1)
        assert done.status is TaskStatus.FAILED
        assert account.frozen == 0
        assert account.total_spent == 0
        assert account.balance == quota_settings.register_gift_amount
        assert CreditReason.REFUND in _reasons(session, 1)


def test_generate_character_action_without_account_raises(session_factory):
    service = AiGenerationService()
    action_input = CharacterActionInput(
        character_id=1, action_type=ActionType.WALK, num_frames=2,
    )
    with session_factory() as session:
        with pytest.raises(BizException, match="积分账户不存在"):
            service.generate_character_action(session, user_id=1, input=action_input)
        session.rollback()
        assert session.scalar(select(GenerationTaskRecord)) is None


def test_capture_uses_frozen_amount_when_price_rises(session_factory, monkeypatch):
    with session_factory() as session:
        _seed_account(session, 1)
        session.commit()

    service = AiGenerationService()
    executor = ActionTaskExecutor(
        generator=_SpyGenerator(),
        upload=lambda _png: "https://cdn.example.com/f.png",
        fetch_master=lambda _input: _tiny_png(),
        session_factory=session_factory,
    )
    action_input = CharacterActionInput(
        character_id=1, action_type=ActionType.WALK, num_frames=2,
    )
    with session_factory() as session:
        task = service.generate_character_action(session, user_id=1, input=action_input)
        session.commit()
        task_id = task.id
        frozen_at_submit = quota_settings.generate_action_cost

    monkeypatch.setattr(quota_settings, "generate_action_cost", frozen_at_submit + 40)
    executor.run_action_task(task_id, action_input)

    with session_factory() as session:
        done = service.get_task(session, project_id=1, task_id=task_id)
        account = _account(session, 1)
        assert done.status is TaskStatus.COMPLETED
        assert account.frozen == 0
        assert account.total_spent == frozen_at_submit
        assert account.balance == quota_settings.register_gift_amount - frozen_at_submit


def test_release_uses_frozen_amount_when_price_falls(session_factory, monkeypatch):
    with session_factory() as session:
        _seed_account(session, 1)
        session.commit()

    service = AiGenerationService()

    def _boom(_input):
        raise RuntimeError("母版下载失败")

    executor = ActionTaskExecutor(
        generator=None,
        fetch_master=_boom,
        session_factory=session_factory,
    )
    action_input = CharacterActionInput(
        character_id=1, action_type=ActionType.WALK, num_frames=2,
    )
    with session_factory() as session:
        task = service.generate_character_action(session, user_id=1, input=action_input)
        session.commit()
        task_id = task.id
        frozen_at_submit = quota_settings.generate_action_cost

    monkeypatch.setattr(quota_settings, "generate_action_cost", max(1, frozen_at_submit - 40))
    executor.run_action_task(task_id, action_input)

    with session_factory() as session:
        account = _account(session, 1)
        assert account.frozen == 0
        assert account.balance == quota_settings.register_gift_amount


def test_recover_requeues_pending_tasks_with_open_freeze(session_factory):
    from windup_app.server.orchestrator.recover import recover_orphaned_generation_tasks

    queued: list[tuple] = []

    class _Dispatcher:
        def submit(self, target, *args):
            queued.append((target, args))

    with session_factory() as session:
        _seed_account(session, 1)
        session.commit()

    service = AiGenerationService()
    action_input = CharacterActionInput(
        character_id=1, action_type=ActionType.WALK, num_frames=2,
    )
    with session_factory() as session:
        task = service.generate_character_action(
            session, user_id=1, project_id=7, input=action_input,
        )
        session.commit()
        task_id = task.id

    def _run_image(*_args):
        raise AssertionError("不应入队图片任务")

    def _run_action(*_args):
        raise AssertionError("recover 只负责入队，不直接跑")

    with session_factory() as session:
        recover_orphaned_generation_tasks(
            session,
            dispatcher=_Dispatcher(),
            run_image_task=_run_image,
            run_action_task=_run_action,
        )
        session.commit()

    assert len(queued) == 1
    _target, args = queued[0]
    assert _target is _run_action
    assert args[0] == task_id
    assert args[1].action_type is ActionType.WALK
    assert args[2] == 7

    with session_factory() as session:
        still = service.get_task(session, project_id=7, task_id=task_id)
        assert still.status is TaskStatus.PENDING
        assert _account(session, 1).frozen == quota_settings.generate_action_cost


def test_recover_fails_and_unfreezes_running_orphans(session_factory):
    from windup_app.server.orchestrator import task_repo
    from windup_app.server.orchestrator.recover import recover_orphaned_generation_tasks

    with session_factory() as session:
        _seed_account(session, 1)
        session.commit()

    service = AiGenerationService()
    action_input = CharacterActionInput(
        character_id=1, action_type=ActionType.WALK, num_frames=2,
    )
    with session_factory() as session:
        task = service.generate_character_action(session, user_id=1, input=action_input)
        task_repo.update_status(session, task.id, TaskStatus.RUNNING)
        session.commit()
        task_id = task.id

    with session_factory() as session:
        recover_orphaned_generation_tasks(
            session,
            dispatcher=type("D", (), {"submit": staticmethod(lambda *a, **k: None)})(),
            run_image_task=lambda *a: None,
            run_action_task=lambda *a: None,
        )
        session.commit()

    with session_factory() as session:
        done = service.get_task(session, project_id=1, task_id=task_id)
        account = _account(session, 1)
        assert done.status is TaskStatus.FAILED
        assert "中断" in (done.error_message or "")
        assert account.frozen == 0
        assert account.balance == quota_settings.register_gift_amount
        assert CreditReason.REFUND in _reasons(session, 1)


def test_prepaid_cost_by_task_type():
    assert billing.prepaid_cost(GenerationType.CHARACTER_IMAGE) == quota_settings.generate_image_cost
    assert billing.prepaid_cost(GenerationType.CHARACTER_ACTION) == quota_settings.generate_action_cost
    with pytest.raises(ValueError, match="未知生成类型"):
        billing.prepaid_cost("not-a-type")  # type: ignore[arg-type]


def test_frozen_amount_missing_raises(session_factory):
    with session_factory() as session:
        with pytest.raises(BizException, match="找不到该任务的冻结流水"):
            billing.frozen_amount_for_task(session, 999)


def test_has_open_freeze_false_without_frozen_txn(session_factory):
    with session_factory() as session:
        assert billing.has_open_freeze(session, 1) is False


def test_has_open_freeze_false_after_capture_or_release(session_factory):
    with session_factory() as session:
        _seed_account(session, 1)
        session.commit()
    service = AiGenerationService()
    image_input = CharacterImageInput(prompt="x", width=64, height=64)
    with session_factory() as session:
        captured = service.generate_character_image(session, user_id=1, input=image_input)
        billing.capture_for_task(session, user_id=1, task_id=captured.id)
        released = service.generate_character_image(session, user_id=1, input=image_input)
        billing.release_for_task(session, user_id=1, task_id=released.id)
        session.commit()
        assert billing.has_open_freeze(session, captured.id) is False
        assert billing.has_open_freeze(session, released.id) is False


def test_image_success_captures_reserved_credit(session_factory):
    with session_factory() as session:
        _seed_account(session, 1)
        session.commit()

    executor = ImageTaskExecutor(
        upload=lambda _png: "https://cdn.example.com/img.png",
        session_factory=session_factory,
    )
    executor._produce_image = lambda _input, _cons: ["https://cdn.example.com/img.png"]
    image_input = CharacterImageInput(prompt="勇者", width=64, height=64)
    with session_factory() as session:
        task = AiGenerationService().generate_character_image(
            session, user_id=1, input=image_input,
        )
        session.commit()
        task_id = task.id

    executor.run_image_task(task_id, image_input)

    with session_factory() as session:
        done = AiGenerationService().get_task(session, project_id=1, task_id=task_id)
        account = _account(session, 1)
        assert done.status is TaskStatus.COMPLETED
        assert account.frozen == 0
        assert account.total_spent == quota_settings.generate_image_cost
        assert CreditReason.CAPTURED in _reasons(session, 1)


def test_image_failure_releases_reserved_credit(session_factory):
    with session_factory() as session:
        _seed_account(session, 1)
        session.commit()

    executor = ImageTaskExecutor(session_factory=session_factory)

    def _boom(_input, _cons):
        raise RuntimeError("出图失败")

    executor._produce_image = _boom
    image_input = CharacterImageInput(prompt="勇者", width=64, height=64)
    with session_factory() as session:
        task = AiGenerationService().generate_character_image(
            session, user_id=1, input=image_input,
        )
        session.commit()
        task_id = task.id

    executor.run_image_task(task_id, image_input)

    with session_factory() as session:
        done = AiGenerationService().get_task(session, project_id=1, task_id=task_id)
        account = _account(session, 1)
        assert done.status is TaskStatus.FAILED
        assert account.frozen == 0
        assert account.balance == quota_settings.register_gift_amount


def test_recover_skips_pending_without_open_freeze(session_factory):
    from windup_app.server.orchestrator import task_repo
    from windup_app.server.orchestrator.recover import recover_orphaned_generation_tasks

    queued: list = []

    class _Dispatcher:
        def submit(self, target, *args):
            queued.append((target, args))

    with session_factory() as session:
        task_repo.create_task(
            session, user_id=1, project_id=1,
            task_type=GenerationType.CHARACTER_IMAGE,
            input_payload={"prompt": "x"},
        )
        session.commit()

    with session_factory() as session:
        recover_orphaned_generation_tasks(
            session,
            dispatcher=_Dispatcher(),
            run_image_task=lambda *a: None,
            run_action_task=lambda *a: None,
        )

    assert queued == []


def test_recover_requeues_pending_image_tasks(session_factory):
    from windup_app.server.orchestrator.recover import recover_orphaned_generation_tasks

    queued: list[tuple] = []

    class _Dispatcher:
        def submit(self, target, *args):
            queued.append((target, args))

    with session_factory() as session:
        _seed_account(session, 1)
        session.commit()

    image_input = CharacterImageInput(prompt="勇者", width=64, height=64)
    with session_factory() as session:
        task = AiGenerationService().generate_character_image(
            session, user_id=1, project_id=3, input=image_input,
        )
        session.commit()
        task_id = task.id

    def _run_image(*_args):
        raise AssertionError("只入队")

    with session_factory() as session:
        recover_orphaned_generation_tasks(
            session,
            dispatcher=_Dispatcher(),
            run_image_task=_run_image,
            run_action_task=lambda *a: None,
        )

    assert len(queued) == 1
    target, args = queued[0]
    assert target is _run_image
    assert args[0] == task_id
    assert args[1].prompt == "勇者"
    assert args[2] == 3


def test_recover_unfreezes_when_requeue_fails(session_factory):
    from windup_app.server.orchestrator.recover import recover_orphaned_generation_tasks

    class _BoomDispatcher:
        def submit(self, *_args, **_kwargs):
            raise RuntimeError("队列不可用")

    with session_factory() as session:
        _seed_account(session, 1)
        session.commit()

    with session_factory() as session:
        task = AiGenerationService().generate_character_action(
            session, user_id=1,
            input=CharacterActionInput(character_id=1, action_type=ActionType.WALK, num_frames=2),
        )
        session.commit()
        task_id = task.id

    with session_factory() as session:
        recover_orphaned_generation_tasks(
            session,
            dispatcher=_BoomDispatcher(),
            run_image_task=lambda *a: None,
            run_action_task=lambda *a: None,
        )
        session.commit()

    with session_factory() as session:
        done = AiGenerationService().get_task(session, project_id=1, task_id=task_id)
        account = _account(session, 1)
        assert done.status is TaskStatus.FAILED
        assert account.frozen == 0
        assert account.balance == quota_settings.register_gift_amount


def test_recover_unfreezes_unknown_task_type(session_factory, monkeypatch):
    from windup_app.server.orchestrator import task_repo
    from windup_app.server.orchestrator.recover import recover_orphaned_generation_tasks

    queued: list = []

    class _Dispatcher:
        def submit(self, target, *args):
            queued.append((target, args))

    with session_factory() as session:
        _seed_account(session, 1)
        session.commit()

    with session_factory() as session:
        task = AiGenerationService().generate_character_action(
            session, user_id=1,
            input=CharacterActionInput(character_id=1, action_type=ActionType.WALK, num_frames=2),
        )
        session.commit()
        task_id = task.id

    original = task_repo.list_by_status

    def _unknown_type(session, statuses):
        tasks = original(session, statuses)
        for item in tasks:
            item.task_type = "future_kind"  # type: ignore[assignment]
        return tasks

    monkeypatch.setattr(task_repo, "list_by_status", _unknown_type)

    with session_factory() as session:
        recover_orphaned_generation_tasks(
            session,
            dispatcher=_Dispatcher(),
            run_image_task=lambda *a: None,
            run_action_task=lambda *a: None,
        )
        session.commit()

    assert queued == []
    with session_factory() as session:
        done = AiGenerationService().get_task(session, project_id=1, task_id=task_id)
        assert done.status is TaskStatus.FAILED
        assert _account(session, 1).frozen == 0
