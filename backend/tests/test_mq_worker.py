"""Worker handler / consumer / pending 超时单测。"""

from __future__ import annotations

import json
import threading
import uuid
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock

import pytest
from sqlalchemy.orm import sessionmaker

from conftest import seed_credit_account
from windup_app.server.mq.catalog import (
    MSG_TYPE_CHARACTER_IMAGE,
    MSG_TYPE_VERIFICATION_CODE,
)
from windup_app.server.orchestrator import billing, task_repo
from windup_app.server.orchestrator.model import (
    GenerationType,
    TaskStatus,
)
from windup_app.server.orchestrator.service import AiGenerationService
from windup_app.server.orchestrator.model import CharacterImageInput
from windup_app.worker.consumer import ConsumerConfig, StreamConsumer
from windup_app.worker.handlers import (
    dispatch_handler,
    handle_generation,
    handle_verification_code,
)
from windup_app.worker.pending_timeout import release_stale_pending_tasks
from windup_framework.db.base import Base
from windup_framework.mq.config import MAX_CONSUME_ATTEMPTS
from windup_framework.mq.model import MqMessage
from windup_framework.mq import repository as mq_repo


@pytest.fixture()
def worker_session(engine):
    Base.metadata.create_all(engine, tables=[MqMessage.__table__])
    session_local = sessionmaker(bind=engine, expire_on_commit=False)
    session = session_local()
    try:
        yield session
    finally:
        session.close()


def test_handle_verification_code_sends_email(monkeypatch):
    redis_mock = MagicMock()
    redis_mock.get.return_value = b"123456"
    monkeypatch.setattr("windup_app.worker.handlers.get_redis", lambda: redis_mock)

    sent: list[tuple[str, bytes]] = []
    monkeypatch.setattr(
        "windup_app.worker.handlers.email_provider.send_verification_code",
        lambda email, code: sent.append((email, code)),
    )
    monkeypatch.setattr("windup_app.worker.handlers.time.sleep", lambda _s: None)

    handle_verification_code({"email": "user@example.com", "purpose": "login"})

    assert sent == [("user@example.com", b"123456")]


def test_handle_verification_code_skips_expired_code(monkeypatch):
    redis_mock = MagicMock()
    redis_mock.get.return_value = None
    monkeypatch.setattr("windup_app.worker.handlers.get_redis", lambda: redis_mock)

    called = False

    def _send(*_args):
        nonlocal called
        called = True

    monkeypatch.setattr("windup_app.worker.handlers.email_provider.send_verification_code", _send)

    handle_verification_code({"email": "user@example.com", "purpose": "login"})
    assert called is False


def test_handle_verification_code_retries_then_raises(monkeypatch):
    redis_mock = MagicMock()
    redis_mock.get.return_value = b"654321"
    monkeypatch.setattr("windup_app.worker.handlers.get_redis", lambda: redis_mock)
    monkeypatch.setattr("windup_app.worker.handlers.time.sleep", lambda _s: None)

    attempts = {"count": 0}

    def _fail(*_args):
        attempts["count"] += 1
        raise RuntimeError("smtp down")

    monkeypatch.setattr("windup_app.worker.handlers.email_provider.send_verification_code", _fail)

    with pytest.raises(RuntimeError, match="smtp down"):
        handle_verification_code({"email": "user@example.com", "purpose": "login"})
    assert attempts["count"] == 3


def test_handle_generation_skips_terminal_task(db_session, engine, monkeypatch):
    _patch_worker_session_local(monkeypatch, engine)
    seed_credit_account(db_session, 1)
    db_session.commit()

    service = AiGenerationService()
    task = service.generate_character_image(
        db_session,
        user_id=1,
        project_id=1,
        input=CharacterImageInput(prompt="hero"),
    )
    task_repo.update_status(db_session, task.id, TaskStatus.COMPLETED)
    db_session.commit()

    run_image = MagicMock()
    handle_generation(
        {"task_id": task.id, "task_type": GenerationType.CHARACTER_IMAGE.value},
        run_image_task=run_image,
        run_action_task=MagicMock(),
    )
    run_image.assert_not_called()


def test_handle_generation_dispatches_image_task(db_session, engine, monkeypatch):
    _patch_worker_session_local(monkeypatch, engine)
    seed_credit_account(db_session, 1)
    db_session.commit()

    service = AiGenerationService()
    task = service.generate_character_image(
        db_session,
        user_id=1,
        project_id=1,
        input=CharacterImageInput(prompt="hero", width=512, height=512),
    )
    db_session.commit()

    run_image = MagicMock()
    handle_generation(
        {"task_id": task.id, "task_type": GenerationType.CHARACTER_IMAGE.value},
        run_image_task=run_image,
        run_action_task=MagicMock(),
    )
    run_image.assert_called_once()
    assert run_image.call_args.args[0] == task.id


def test_dispatch_handler_unknown_type_raises():
    with pytest.raises(ValueError, match="未知消息类型"):
        dispatch_handler(
            "unknown",
            {},
            run_image_task=MagicMock(),
            run_action_task=MagicMock(),
        )


def test_dispatch_handler_routes_verification_code(monkeypatch):
    called = {"ok": False}

    monkeypatch.setattr(
        "windup_app.worker.handlers.handle_verification_code",
        lambda payload: called.update(ok=True),
    )

    dispatch_handler(
        MSG_TYPE_VERIFICATION_CODE,
        {"email": "a@x.com", "purpose": "login"},
        run_image_task=MagicMock(),
        run_action_task=MagicMock(),
    )
    assert called["ok"] is True


def _patch_worker_session_local(monkeypatch, engine):
    session_local = sessionmaker(bind=engine, expire_on_commit=False)
    monkeypatch.setattr("windup_framework.db.session.SessionLocal", session_local)
    monkeypatch.setattr("windup_app.worker.consumer.SessionLocal", session_local)
    monkeypatch.setattr("windup_app.worker.handlers.SessionLocal", session_local)
    monkeypatch.setattr("windup_app.worker.pending_timeout.SessionLocal", session_local)
    return session_local


def _published_message(worker_session, *, message_id: uuid.UUID | None = None) -> uuid.UUID:
    message_id = message_id or uuid.uuid4()
    mq_repo.insert_pending(
        worker_session,
        message_id=message_id,
        dedupe_key=f"email:{message_id}",
        stream="windup:stream:email",
        msg_type=MSG_TYPE_VERIFICATION_CODE,
        payload={"email": "a@x.com", "purpose": "login"},
    )
    mq_repo.mark_published(worker_session, message_id, "1-0")
    worker_session.commit()
    return message_id


def test_consumer_process_message_marks_acked(engine, worker_session, monkeypatch):
    message_id = _published_message(worker_session)
    _patch_worker_session_local(monkeypatch, engine)

    redis_mock = MagicMock()
    monkeypatch.setattr("windup_app.worker.consumer.get_redis", lambda: redis_mock)
    monkeypatch.setattr(
        "windup_app.worker.consumer.dispatch_handler",
        lambda *_args, **_kwargs: None,
    )

    consumer = StreamConsumer(
        ConsumerConfig(stream="windup:stream:email", group="email", concurrency=1),
        run_image_task=MagicMock(),
        run_action_task=MagicMock(),
        stop_event=threading.Event(),
    )
    envelope = {
        "v": 1,
        "id": str(message_id),
        "type": MSG_TYPE_VERIFICATION_CODE,
        "payload": {"email": "a@x.com", "purpose": "login"},
    }
    consumer._process_message("1-0", {"data": json.dumps(envelope)})

    redis_mock.xack.assert_called_once()
    row = worker_session.get(MqMessage, message_id)
    assert row.consume_status == "acked"


def test_consumer_process_message_releases_claim_on_retryable_failure(
    engine,
    worker_session,
    monkeypatch,
):
    message_id = _published_message(worker_session)
    row = worker_session.get(MqMessage, message_id)
    row.consume_attempts = 1
    worker_session.commit()

    _patch_worker_session_local(monkeypatch, engine)
    redis_mock = MagicMock()
    monkeypatch.setattr("windup_app.worker.consumer.get_redis", lambda: redis_mock)

    def _boom(*_args, **_kwargs):
        raise RuntimeError("handler failed")

    monkeypatch.setattr("windup_app.worker.consumer.dispatch_handler", _boom)

    consumer = StreamConsumer(
        ConsumerConfig(stream="windup:stream:email", group="email", concurrency=1),
        run_image_task=MagicMock(),
        run_action_task=MagicMock(),
        stop_event=threading.Event(),
    )
    envelope = {
        "v": 1,
        "id": str(message_id),
        "type": MSG_TYPE_VERIFICATION_CODE,
        "payload": {"email": "a@x.com", "purpose": "login"},
    }
    consumer._process_message("1-0", {"data": json.dumps(envelope)})

    row = worker_session.get(MqMessage, message_id)
    assert row.consume_status is None
    redis_mock.xack.assert_not_called()


def test_consumer_process_message_marks_failed_at_max_attempts(
    engine,
    worker_session,
    monkeypatch,
):
    message_id = _published_message(worker_session)
    row = worker_session.get(MqMessage, message_id)
    row.consume_attempts = MAX_CONSUME_ATTEMPTS - 1
    worker_session.commit()

    _patch_worker_session_local(monkeypatch, engine)
    redis_mock = MagicMock()
    monkeypatch.setattr("windup_app.worker.consumer.get_redis", lambda: redis_mock)

    def _boom(*_args, **_kwargs):
        raise RuntimeError("terminal")

    monkeypatch.setattr("windup_app.worker.consumer.dispatch_handler", _boom)

    consumer = StreamConsumer(
        ConsumerConfig(stream="windup:stream:email", group="email", concurrency=1),
        run_image_task=MagicMock(),
        run_action_task=MagicMock(),
        stop_event=threading.Event(),
    )
    envelope = {
        "v": 1,
        "id": str(message_id),
        "type": MSG_TYPE_VERIFICATION_CODE,
        "payload": {"email": "a@x.com", "purpose": "login"},
    }
    consumer._process_message("1-0", {"data": json.dumps(envelope)})

    row = worker_session.get(MqMessage, message_id)
    worker_session.refresh(row)
    assert row.consume_status == "failed"
    redis_mock.xack.assert_called_once()


def test_consumer_skips_already_done_message(engine, worker_session, monkeypatch):
    message_id = _published_message(worker_session)
    mq_repo.mark_consumed(worker_session, message_id, "acked")
    worker_session.commit()

    _patch_worker_session_local(monkeypatch, engine)
    redis_mock = MagicMock()
    monkeypatch.setattr("windup_app.worker.consumer.get_redis", lambda: redis_mock)

    consumer = StreamConsumer(
        ConsumerConfig(stream="windup:stream:email", group="email", concurrency=1),
        run_image_task=MagicMock(),
        run_action_task=MagicMock(),
        stop_event=threading.Event(),
    )
    envelope = {
        "v": 1,
        "id": str(message_id),
        "type": MSG_TYPE_VERIFICATION_CODE,
        "payload": {"email": "a@x.com", "purpose": "login"},
    }
    consumer._process_message("1-0", {"data": json.dumps(envelope)})

    redis_mock.xack.assert_called_once()


def test_release_stale_pending_tasks_unfreezes(db_session, engine, monkeypatch):
    from windup_app.server.mq.catalog import GENERATION_PENDING_MAX_AGE_SECONDS
    from windup_app.server.orchestrator.model import GenerationTaskRecord

    _patch_worker_session_local(monkeypatch, engine)
    seed_credit_account(db_session, 1)
    task = task_repo.create_task(
        db_session,
        user_id=1,
        project_id=1,
        task_type=GenerationType.CHARACTER_IMAGE,
        input_payload={"prompt": "old"},
    )
    billing.reserve_for_task(db_session, user_id=1, task_id=task.id, task_type=GenerationType.CHARACTER_IMAGE)
    record = db_session.get(GenerationTaskRecord, task.id)
    record.create_at = datetime.now(timezone.utc) - timedelta(
        seconds=GENERATION_PENDING_MAX_AGE_SECONDS + 60,
    )
    db_session.commit()

    released = release_stale_pending_tasks()
    assert released == 1

    db_session.expire_all()
    failed = task_repo.get_task(db_session, task.id)
    assert failed is not None
    assert failed.status is TaskStatus.FAILED
    assert billing.has_open_freeze(db_session, task.id) is False


def test_recover_skips_fresh_running_tasks(db_session, engine, monkeypatch):
    from datetime import datetime, timezone

    from windup_app.server.orchestrator.model import GenerationTaskRecord
    from windup_app.server.orchestrator.recover import recover_orphaned_generation_tasks

    _patch_worker_session_local(monkeypatch, engine)
    seed_credit_account(db_session, 1)
    task = task_repo.create_task(
        db_session,
        user_id=1,
        project_id=1,
        task_type=GenerationType.CHARACTER_IMAGE,
        input_payload={"prompt": "running"},
    )
    billing.reserve_for_task(db_session, user_id=1, task_id=task.id, task_type=GenerationType.CHARACTER_IMAGE)
    task_repo.update_status(db_session, task.id, TaskStatus.RUNNING)
    record = db_session.get(GenerationTaskRecord, task.id)
    record.update_at = datetime.now(timezone.utc)
    db_session.commit()

    class _Publisher:
        def enqueue(self, *_args, **_kwargs):
            raise AssertionError("fresh RUNNING should not requeue")

        def register_after_commit(self, *_args, **_kwargs) -> None:
            raise AssertionError("fresh RUNNING should not requeue")

    recover_orphaned_generation_tasks(
        db_session,
        publisher=_Publisher(),
        fail_stale_running=True,
        running_stale_seconds=3600,
    )

    db_session.expire_all()
    still_running = task_repo.get_task(db_session, task.id)
    assert still_running is not None
    assert still_running.status is TaskStatus.RUNNING


def test_consumer_skips_in_flight_message(engine, worker_session, monkeypatch):
    message_id = _published_message(worker_session)
    mq_repo.try_claim_for_consume(worker_session, message_id)
    worker_session.commit()

    _patch_worker_session_local(monkeypatch, engine)
    redis_mock = MagicMock()
    monkeypatch.setattr("windup_app.worker.consumer.get_redis", lambda: redis_mock)
    dispatched = {"count": 0}
    monkeypatch.setattr(
        "windup_app.worker.consumer.dispatch_handler",
        lambda *_args, **_kwargs: dispatched.update(count=dispatched["count"] + 1),
    )

    consumer = StreamConsumer(
        ConsumerConfig(stream="windup:stream:email", group="email", concurrency=1),
        run_image_task=MagicMock(),
        run_action_task=MagicMock(),
        stop_event=threading.Event(),
    )
    envelope = {
        "v": 1,
        "id": str(message_id),
        "type": MSG_TYPE_VERIFICATION_CODE,
        "payload": {"email": "a@x.com", "purpose": "login"},
    }
    consumer._process_message("1-0", {"data": json.dumps(envelope)})

    assert dispatched["count"] == 0
    redis_mock.xack.assert_called_once()


def test_consumer_acquires_generation_semaphore(engine, worker_session, monkeypatch):
    from windup_app.server.mq.catalog import MSG_TYPE_CHARACTER_IMAGE

    message_id = uuid.uuid4()
    mq_repo.insert_pending(
        worker_session,
        message_id=message_id,
        dedupe_key=f"generation:{message_id}",
        stream="windup:stream:generation",
        msg_type=MSG_TYPE_CHARACTER_IMAGE,
        payload={"task_id": 1, "task_type": "character_image"},
    )
    mq_repo.mark_published(worker_session, message_id, "2-0")
    worker_session.commit()

    _patch_worker_session_local(monkeypatch, engine)
    redis_mock = MagicMock()
    monkeypatch.setattr("windup_app.worker.consumer.get_redis", lambda: redis_mock)
    monkeypatch.setattr(
        "windup_app.worker.consumer.dispatch_handler",
        lambda *_args, **_kwargs: None,
    )

    consumer = StreamConsumer(
        ConsumerConfig(stream="windup:stream:generation", group="generation", concurrency=1),
        run_image_task=MagicMock(),
        run_action_task=MagicMock(),
        stop_event=threading.Event(),
    )
    envelope = {
        "v": 1,
        "id": str(message_id),
        "type": MSG_TYPE_CHARACTER_IMAGE,
        "payload": {"task_id": 1, "task_type": "character_image"},
    }
    consumer._process_message("2-0", {"data": json.dumps(envelope)})

    redis_mock.xack.assert_called_once()

