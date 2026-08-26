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
    GenerationTask,
    GenerationTaskRecord,
    GenerationType,
    TaskStatus,
)
from windup_app.server.orchestrator.service import AiGenerationService
from windup_app.server.quota.model import CreditAccount, CreditTransaction
from windup_common.enums.quota import CreditReason
from windup_common.exceptions import BizException
from windup_framework.config.quota import settings as quota_settings
from windup_framework.mq.model import MqMessage  # noqa: F401 — register metadata

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


def _tracking_publisher():
    """记录 recover 入队参数的 mock publisher。"""
    enqueued: list[dict] = []

    class _Publisher:
        def enqueue(self, session, *, stream, msg_type, payload, dedupe_key):
            enqueued.append(
                {
                    "stream": stream,
                    "msg_type": msg_type,
                    "payload": payload,
                    "dedupe_key": dedupe_key,
                },
            )
            import uuid

            return uuid.uuid4()

        def register_after_commit(self, session, message_id) -> None:
            pass

    return _Publisher(), enqueued


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
    frozen = quota_settings.generate_image_cost * 3
    assert account.frozen == frozen
    assert account.balance == quota_settings.register_gift_amount - frozen
    assert _reasons(db_session, 1) == [CreditReason.FROZEN]
    txn = db_session.scalar(select(CreditTransaction).where(CreditTransaction.user_id == 1))
    assert txn.ref_id == f"task:{task_id}"


def test_submit_image_generation_reserves_per_requested_image(auth_client, db_session):
    _seed_account(db_session, 1)
    db_session.commit()

    project = auth_client.post(
        "/projects",
        json={
            "project_name": "按张计费",
            "character_perspective": 1,
            "directional_movement": 2,
            "sprite_width": 64,
            "sprite_height": 64,
        },
    ).json()["data"]

    one = auth_client.post(
        "/generation/image",
        json={
            "project_id": project["id"], "prompt": "勇者",
            "width": 64, "height": 64, "num_images": 1,
        },
    )
    four = auth_client.post(
        "/generation/image",
        json={
            "project_id": project["id"], "prompt": "勇者",
            "width": 64, "height": 64, "num_images": 4,
        },
    )
    assert one.json()["data"] is not None, one.json()
    assert four.json()["data"] is not None, four.json()

    account = _account(db_session, 1)
    db_session.refresh(account)
    frozen = quota_settings.generate_image_cost * 5
    assert account.frozen == frozen
    assert account.balance == quota_settings.register_gift_amount - frozen


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


def test_submit_rejects_when_credit_covers_one_image_but_not_three(auth_client, db_session):
    _seed_account(db_session, 1, balance=quota_settings.generate_image_cost)
    db_session.commit()

    project = auth_client.post(
        "/projects",
        json={
            "project_name": "一张的钱不够三张",
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
    assert account.balance == quota_settings.generate_image_cost
    assert account.frozen == 0


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


def test_action_failure_redelivery_does_not_raise(session_factory):
    """失败已解冻后 MQ 重投同一失败路径，不得再抛冻结额度不足。"""
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
    executor.run_action_task(task_id, action_input)

    with session_factory() as session:
        done = service.get_task(session, project_id=1, task_id=task_id)
        account = _account(session, 1)
        refunds = [
            row for row in session.scalars(
                select(CreditTransaction).where(CreditTransaction.user_id == 1)
            )
            if row.reason == CreditReason.REFUND
        ]
        assert done.status is TaskStatus.FAILED
        assert account.frozen == 0
        assert account.balance == quota_settings.register_gift_amount
        assert len(refunds) == 1


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

    publisher, enqueued = _tracking_publisher()

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

    with session_factory() as session:
        recover_orphaned_generation_tasks(session, publisher=publisher)
        session.commit()

    assert len(enqueued) == 1
    assert enqueued[0]["dedupe_key"] == f"generation:{task_id}"
    assert enqueued[0]["msg_type"] == "character_action"
    assert enqueued[0]["payload"]["task_id"] == task_id

    with session_factory() as session:
        still = service.get_task(session, project_id=7, task_id=task_id)
        assert still.status is TaskStatus.PENDING
        assert _account(session, 1).frozen == quota_settings.generate_action_cost


def test_recover_fails_and_unfreezes_running_orphans(session_factory):
    from datetime import datetime, timedelta, timezone

    from windup_app.server.orchestrator import task_repo
    from windup_app.server.orchestrator.model import GenerationTaskRecord
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
        record = session.get(GenerationTaskRecord, task.id)
        record.update_at = datetime.now(timezone.utc) - timedelta(hours=2)
        session.commit()
        task_id = task.id

    with session_factory() as session:
        recover_orphaned_generation_tasks(
            session,
            publisher=_tracking_publisher()[0],
            fail_stale_running=True,
            running_stale_seconds=60,
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


def test_prepaid_cost_scales_with_model_calls():
    unit = quota_settings.generate_image_cost
    assert billing.prepaid_cost(GenerationType.CHARACTER_IMAGE, 1) == unit
    assert billing.prepaid_cost(GenerationType.CHARACTER_IMAGE, 3) == unit * 3
    assert billing.prepaid_cost(GenerationType.CHARACTER_FOUR_VIEW, 2) == unit * 2
    assert billing.prepaid_cost(GenerationType.CHARACTER_EIGHT_VIEW, 4) == unit * 4
    assert billing.prepaid_cost(GenerationType.CHARACTER_ACTION, 1) == quota_settings.generate_action_cost
    with pytest.raises(ValueError, match="model_calls"):
        billing.prepaid_cost(GenerationType.CHARACTER_IMAGE, 0)
    with pytest.raises(ValueError, match="未知生成类型"):
        billing.prepaid_cost("not-a-type", 1)  # type: ignore[arg-type]


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
    executor._produce_image = lambda _input, _cons: (
        ["https://cdn.example.com/img.png"], {"subject_blobs": [1]},
    )
    image_input = CharacterImageInput(prompt="勇者", width=64, height=64, num_images=3)
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
        assert account.total_spent == quota_settings.generate_image_cost * 3
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

    publisher, enqueued = _tracking_publisher()

    with session_factory() as session:
        task_repo.create_task(
            session, user_id=1, project_id=1,
            task_type=GenerationType.CHARACTER_IMAGE,
            input_payload={"prompt": "x"},
        )
        session.commit()

    with session_factory() as session:
        recover_orphaned_generation_tasks(session, publisher=publisher)

    assert enqueued == []


def test_recover_requeues_pending_image_tasks(session_factory):
    from windup_app.server.orchestrator.recover import recover_orphaned_generation_tasks

    publisher, enqueued = _tracking_publisher()

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

    with session_factory() as session:
        recover_orphaned_generation_tasks(session, publisher=publisher)

    assert len(enqueued) == 1
    assert enqueued[0]["msg_type"] == "character_image"
    assert enqueued[0]["payload"]["task_id"] == task_id


def test_recover_unfreezes_when_requeue_fails(session_factory):
    from windup_app.server.orchestrator.recover import recover_orphaned_generation_tasks

    class _BoomPublisher:
        def enqueue(self, *_args, **_kwargs):
            raise RuntimeError("队列不可用")

        def register_after_commit(self, *_args, **_kwargs) -> None:
            pass

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
        recover_orphaned_generation_tasks(session, publisher=_BoomPublisher())
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

    publisher, enqueued = _tracking_publisher()

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
        recover_orphaned_generation_tasks(session, publisher=publisher)
        session.commit()

    assert enqueued == []
    with session_factory() as session:
        done = AiGenerationService().get_task(session, project_id=1, task_id=task_id)
        assert done.status is TaskStatus.FAILED
        assert _account(session, 1).frozen == 0


# ── 没有冻结流水的开放任务也必须被恢复 ─────────────────────────────────────
#
# 线上攒下 3 条 running 了四五天、1 条同样久的 pending，它们都没有 FROZEN 流水
# （136 条 completed 里 124 条也没有——多数任务早于计费接入）。用户那侧看到的是
# 任务一直转圈：既没有终态，也没有错误信息。


def _drop_freeze_rows(session: Session, task_id: int) -> None:
    """把冻结流水抹掉，复刻线上那批任务的形状。"""
    for txn in session.scalars(
        select(CreditTransaction).where(
            CreditTransaction.ref_id.like(f"task:{task_id}%")
        )
    ):
        session.delete(txn)
    session.flush()
    assert not billing.has_open_freeze(session, task_id)


def _open_task(session_factory, status: TaskStatus) -> int:
    from windup_app.server.orchestrator import task_repo

    with session_factory() as session:
        _seed_account(session, 1)
        session.commit()
    service = AiGenerationService()
    with session_factory() as session:
        task = service.generate_character_action(
            session, user_id=1, project_id=7,
            input=CharacterActionInput(
                character_id=1, action_type=ActionType.WALK, num_frames=2,
            ),
        )
        if status is not TaskStatus.PENDING:
            task_repo.update_status(session, task.id, status)
        _drop_freeze_rows(session, task.id)
        session.commit()
        return task.id


def test_running_orphan_without_freeze_still_reaches_a_terminal_status(session_factory):
    from windup_app.server.orchestrator.recover import recover_orphaned_generation_tasks

    task_id = _open_task(session_factory, TaskStatus.RUNNING)
    publisher, _enqueued = _tracking_publisher()

    with session_factory() as session:
        recover_orphaned_generation_tasks(session, publisher=publisher)
        session.commit()

    with session_factory() as session:
        done = AiGenerationService().get_task(session, project_id=7, task_id=task_id)
        assert done.status is TaskStatus.FAILED, "无冻结的 running 任务被跳过了"
        assert "中断" in (done.error_message or "")
        # 没退过积分就不能说"已解冻"，否则用户会去查一笔不存在的账。
        assert "解冻" not in (done.error_message or "")
        assert "重新提交" in (done.error_message or "")
        assert CreditReason.REFUND not in _reasons(session, 1)


def test_pending_orphan_without_freeze_reaches_a_terminal_status_without_rerunning(
    session_factory,
):
    """免费重跑与永久开放态之间选前者不可接受，所以只保证它不再停在 pending。"""
    from windup_app.server.orchestrator.recover import recover_orphaned_generation_tasks

    task_id = _open_task(session_factory, TaskStatus.PENDING)
    publisher, enqueued = _tracking_publisher()

    with session_factory() as session:
        recover_orphaned_generation_tasks(session, publisher=publisher)
        session.commit()

    assert enqueued == [], "没有冻结的任务被重入队了，等于免费跑一次"
    with session_factory() as session:
        done = AiGenerationService().get_task(session, project_id=7, task_id=task_id)
        assert done.status is TaskStatus.FAILED, "无冻结的 pending 任务还停在开放态"
        assert "重新提交" in (done.error_message or "")


def test_a_row_without_an_id_is_skipped_instead_of_crashing_recovery(
    session_factory, monkeypatch
):
    """没有主键的任务行只跳过，不能让整轮对账炸掉、也不能被写成失败。

    对账在进程启动时跑，一行坏数据把它打死等于所有开放任务都失去恢复机会。
    """
    from windup_app.server.orchestrator import recover as recover_mod
    from windup_app.server.orchestrator.recover import recover_orphaned_generation_tasks

    orphan = GenerationTask(
        user_id=1, project_id=7, task_type=GenerationType.CHARACTER_ACTION,
        status=TaskStatus.RUNNING, input_payload={},
    )
    assert orphan.id is None
    monkeypatch.setattr(recover_mod.task_repo, "list_by_status", lambda *a, **k: [orphan])
    monkeypatch.setattr(
        recover_mod.task_repo, "update_status",
        lambda *a, **k: pytest.fail("没有主键的行被写状态了"),
    )

    with session_factory() as session:
        recover_orphaned_generation_tasks(
            session,
            publisher=_tracking_publisher()[0],
        )
