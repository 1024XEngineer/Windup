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
    MSG_TYPE_CHARACTER_ACTION,
    MSG_TYPE_CHARACTER_ACTION_POLL,
    MSG_TYPE_CHARACTER_IMAGE,
    MSG_TYPE_VERIFICATION_CODE,
)
from windup_app.server.orchestrator import billing, task_repo
from windup_app.server.orchestrator.model import (
    ActionType,
    CharacterActionInput,
    GenerationType,
    TaskStatus,
)
from windup_app.server.orchestrator.service import AiGenerationService
from windup_app.server.orchestrator.model import CharacterImageInput
from windup_app.worker.consumer import ConsumerConfig, StreamConsumer, start_relay_loop
from windup_app.worker.handlers import (
    HandlerDeferred,
    dispatch_handler,
    handle_generation,
    handle_verification_code,
)
from windup_app.worker.pending_timeout import release_stale_pending_tasks
from windup_common.directions import ActionDirection
from windup_common.models import CharacterStance
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
        input=CharacterImageInput(
            prompt="hero", width=512, height=512, direction=ActionDirection.NORTH
        ),
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
    assert run_image.call_args.args[1].direction is ActionDirection.NORTH


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


def test_handle_generation_skips_missing_task(engine, monkeypatch):
    _patch_worker_session_local(monkeypatch, engine)
    run_image = MagicMock()
    handle_generation(
        {"task_id": 9999, "task_type": GenerationType.CHARACTER_IMAGE.value},
        run_image_task=run_image,
        run_action_task=MagicMock(),
    )
    run_image.assert_not_called()


def test_handle_generation_defers_when_running(db_session, engine, monkeypatch):
    _patch_worker_session_local(monkeypatch, engine)
    seed_credit_account(db_session, 1)
    db_session.commit()

    service = AiGenerationService()
    task = service.generate_character_image(
        db_session,
        user_id=1,
        project_id=1,
        input=CharacterImageInput(prompt="running"),
    )
    task_repo.update_status(db_session, task.id, TaskStatus.RUNNING)
    db_session.commit()

    with pytest.raises(HandlerDeferred, match="still running"):
        handle_generation(
            {"task_id": task.id, "task_type": GenerationType.CHARACTER_IMAGE.value},
            run_image_task=MagicMock(),
            run_action_task=MagicMock(),
        )


def test_handle_generation_skips_without_open_freeze(db_session, engine, monkeypatch):
    _patch_worker_session_local(monkeypatch, engine)
    task = task_repo.create_task(
        db_session,
        user_id=1,
        project_id=1,
        task_type=GenerationType.CHARACTER_IMAGE,
        input_payload={"prompt": "no-freeze"},
    )
    db_session.commit()

    run_image = MagicMock()
    handle_generation(
        {"task_id": task.id, "task_type": GenerationType.CHARACTER_IMAGE.value},
        run_image_task=run_image,
        run_action_task=MagicMock(),
    )
    run_image.assert_not_called()


def test_handle_generation_dispatches_action_task(db_session, engine, monkeypatch):
    _patch_worker_session_local(monkeypatch, engine)
    seed_credit_account(db_session, 1)
    db_session.commit()

    service = AiGenerationService()
    task = service.generate_character_action(
        db_session,
        user_id=1,
        project_id=1,
        input=CharacterActionInput(
            character_id=1,
            action_type=ActionType.WALK,
            num_frames=4,
            direction=ActionDirection.SOUTH,
            stance=CharacterStance.QUADRUPED,
        ),
    )
    db_session.commit()

    run_action = MagicMock()
    handle_generation(
        {"task_id": task.id, "task_type": GenerationType.CHARACTER_ACTION.value},
        run_image_task=MagicMock(),
        run_action_task=run_action,
    )
    run_action.assert_called_once()
    assert run_action.call_args.args[0] == task.id
    assert run_action.call_args.args[1].direction is ActionDirection.SOUTH
    assert run_action.call_args.args[1].stance is CharacterStance.QUADRUPED


def test_handle_generation_unknown_type_raises(db_session, engine, monkeypatch):
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
    db_session.commit()

    with pytest.raises(ValueError, match="未知生成任务类型"):
        handle_generation(
            {"task_id": task.id, "task_type": "not-a-type"},
            run_image_task=MagicMock(),
            run_action_task=MagicMock(),
        )


def test_dispatch_handler_routes_action_poll(monkeypatch):
    called = {"ok": False}

    monkeypatch.setattr(
        "windup_app.worker.handlers.handle_action_poll",
        lambda payload, **kwargs: called.update(ok=True, payload=payload),
    )

    dispatch_handler(
        "character_action_poll",
        {"task_id": 9, "task_type": "character_action", "poll_count": 1},
        run_image_task=MagicMock(),
        run_action_task=MagicMock(),
        resume_action_poll=MagicMock(),
    )
    assert called["ok"] is True


def test_dispatch_handler_routes_character_action(monkeypatch):
    called = {"ok": False}

    monkeypatch.setattr(
        "windup_app.worker.handlers.handle_generation",
        lambda payload, **kwargs: called.update(ok=True),
    )

    dispatch_handler(
        MSG_TYPE_CHARACTER_ACTION,
        {"task_id": 1, "task_type": "character_action"},
        run_image_task=MagicMock(),
        run_action_task=MagicMock(),
    )
    assert called["ok"] is True


def test_consumer_process_message_invalid_envelope_is_swallowed(
    engine,
    worker_session,
    monkeypatch,
):
    _patch_worker_session_local(monkeypatch, engine)
    redis_mock = MagicMock()
    monkeypatch.setattr("windup_app.worker.consumer.get_redis", lambda: redis_mock)

    consumer = StreamConsumer(
        ConsumerConfig(stream="windup:stream:email", group="email", concurrency=1),
        run_image_task=MagicMock(),
        run_action_task=MagicMock(),
        stop_event=threading.Event(),
    )
    consumer._process_message("bad-1", {})

    redis_mock.xack.assert_not_called()


def test_consumer_handle_failure_unparseable_envelope(engine, monkeypatch):
    _patch_worker_session_local(monkeypatch, engine)
    redis_mock = MagicMock()
    monkeypatch.setattr("windup_app.worker.consumer.get_redis", lambda: redis_mock)

    consumer = StreamConsumer(
        ConsumerConfig(stream="windup:stream:email", group="email", concurrency=1),
        run_image_task=MagicMock(),
        run_action_task=MagicMock(),
        stop_event=threading.Event(),
    )
    consumer._handle_failure("bad-1", {}, RuntimeError("boom"), message_id=None)

    redis_mock.xack.assert_not_called()


def test_consumer_claim_idle_submits_messages(engine, monkeypatch):
    stop = threading.Event()
    submitted: list[str] = []
    claim_calls = {"count": 0}

    class _Executor:
        def submit(self, fn, stream_id, fields):
            submitted.append(stream_id)

    consumer = StreamConsumer(
        ConsumerConfig(stream="windup:stream:email", group="email", concurrency=1),
        run_image_task=MagicMock(),
        run_action_task=MagicMock(),
        stop_event=stop,
    )
    consumer._executor = _Executor()
    redis_mock = MagicMock()

    def fake_claim(*_args, **_kwargs):
        claim_calls["count"] += 1
        if claim_calls["count"] == 1:
            return ([("2-0", {"data": "{}"})], "2-0")
        return ([], "2-0")

    monkeypatch.setattr(
        "windup_app.worker.consumer.mq_client.claim_idle_messages",
        fake_claim,
    )

    consumer._claim_idle(redis_mock)

    assert submitted == ["2-0"]


def test_consumer_loop_reads_and_processes_one_message(
    engine,
    worker_session,
    monkeypatch,
):
    message_id = _published_message(worker_session)
    _patch_worker_session_local(monkeypatch, engine)

    stop = threading.Event()
    redis_mock = MagicMock()
    monkeypatch.setattr("windup_app.worker.consumer.get_redis", lambda: redis_mock)
    monkeypatch.setattr("windup_app.worker.consumer.mq_client.ensure_consumer_group", lambda *_a: None)
    monkeypatch.setattr(
        "windup_app.worker.consumer.mq_client.claim_idle_messages",
        lambda *_a, **_k: ([], "0-0"),
    )

    processed = threading.Event()

    def fake_process(_self, _stream_id, _fields):
        processed.set()
        stop.set()

    monkeypatch.setattr(StreamConsumer, "_process_message", fake_process)

    envelope = {
        "v": 1,
        "id": str(message_id),
        "type": MSG_TYPE_VERIFICATION_CODE,
        "payload": {"email": "a@x.com", "purpose": "login"},
    }
    fields = {"data": json.dumps(envelope)}

    def fake_xreadgroup(*_args, **_kwargs):
        if stop.is_set():
            return []
        return [("windup:stream:email", [("3-0", fields)])]

    monkeypatch.setattr("windup_app.worker.consumer.mq_client.xreadgroup", fake_xreadgroup)

    consumer = StreamConsumer(
        ConsumerConfig(stream="windup:stream:email", group="email", concurrency=1),
        run_image_task=MagicMock(),
        run_action_task=MagicMock(),
        stop_event=stop,
    )
    thread = consumer.start()
    assert processed.wait(timeout=3)
    stop.set()
    consumer.shutdown()
    thread.join(timeout=3)


def test_start_relay_loop_invokes_relay(monkeypatch):
    relay_calls: list[int] = []
    stop = threading.Event()
    waits = {"count": 0}

    def fake_wait(timeout):
        waits["count"] += 1
        if waits["count"] == 1:
            return False
        stop.set()
        return True

    monkeypatch.setattr(stop, "wait", fake_wait)
    monkeypatch.setattr(
        "windup_framework.mq.relay.relay_pending_messages",
        lambda **kwargs: relay_calls.append(1) or 0,
    )

    thread = start_relay_loop(stop)
    thread.join(timeout=2)

    assert relay_calls == [1]


def test_release_stale_pending_skips_without_open_freeze(db_session, engine, monkeypatch):
    from windup_app.server.mq.catalog import GENERATION_PENDING_MAX_AGE_SECONDS
    from windup_app.server.orchestrator.model import GenerationTaskRecord

    _patch_worker_session_local(monkeypatch, engine)
    task = task_repo.create_task(
        db_session,
        user_id=1,
        project_id=1,
        task_type=GenerationType.CHARACTER_IMAGE,
        input_payload={"prompt": "fresh"},
    )
    record = db_session.get(GenerationTaskRecord, task.id)
    record.create_at = datetime.now(timezone.utc) - timedelta(
        seconds=GENERATION_PENDING_MAX_AGE_SECONDS + 60,
    )
    db_session.commit()

    assert release_stale_pending_tasks() == 0


def test_release_stale_pending_handles_scan_errors(monkeypatch):
    class _BrokenSession:
        def scalars(self, *_args, **_kwargs):
            raise RuntimeError("db down")

        def commit(self) -> None:
            raise AssertionError("should not commit")

        def rollback(self) -> None:
            return None

        def close(self) -> None:
            return None

    monkeypatch.setattr(
        "windup_app.worker.pending_timeout.SessionLocal",
        lambda: _BrokenSession(),
    )

    assert release_stale_pending_tasks() == 0


def test_start_relay_loop_swallows_relay_errors(monkeypatch):
    stop = threading.Event()
    waits = {"count": 0}

    def fake_wait(timeout):
        waits["count"] += 1
        if waits["count"] == 1:
            return False
        stop.set()
        return True

    monkeypatch.setattr(stop, "wait", fake_wait)
    monkeypatch.setattr(
        "windup_framework.mq.relay.relay_pending_messages",
        lambda **kwargs: (_ for _ in ()).throw(RuntimeError("relay failed")),
    )

    thread = start_relay_loop(stop)
    thread.join(timeout=2)

    assert waits["count"] >= 2


def test_consumer_action_message_uses_action_semaphore(
    engine,
    worker_session,
    monkeypatch,
):
    message_id = uuid.uuid4()
    mq_repo.insert_pending(
        worker_session,
        message_id=message_id,
        dedupe_key=f"generation:action:{message_id}",
        stream="windup:stream:generation",
        msg_type=MSG_TYPE_CHARACTER_ACTION,
        payload={"task_id": 2, "task_type": "character_action"},
    )
    mq_repo.mark_published(worker_session, message_id, "4-0")
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
    assert consumer._semaphore_for(MSG_TYPE_CHARACTER_ACTION) is consumer._action_sem

    envelope = {
        "v": 1,
        "id": str(message_id),
        "type": MSG_TYPE_CHARACTER_ACTION,
        "payload": {"task_id": 2, "task_type": "character_action"},
    }
    consumer._process_message("4-0", {"data": json.dumps(envelope)})

    redis_mock.xack.assert_called_once()


def test_consumer_routes_poll_to_reserved_executor():
    consumer = StreamConsumer(
        ConsumerConfig(stream="windup:stream:generation", group="generation", concurrency=2),
        run_image_task=MagicMock(),
        run_action_task=MagicMock(),
        stop_event=threading.Event(),
    )
    try:
        poll_fields = {
            "data": json.dumps({
                "v": 1,
                "id": str(uuid.uuid4()),
                "type": MSG_TYPE_CHARACTER_ACTION_POLL,
                "payload": {"task_id": 1},
            })
        }
        image_fields = {
            "data": json.dumps({
                "v": 1,
                "id": str(uuid.uuid4()),
                "type": MSG_TYPE_CHARACTER_IMAGE,
                "payload": {"task_id": 1},
            })
        }
        assert consumer._poll_executor is not None
        assert consumer._executor_for(poll_fields) is consumer._poll_executor
        assert consumer._executor_for(image_fields) is consumer._executor
    finally:
        consumer.shutdown()


def test_consumer_routes_new_dedicated_pool_from_registry(monkeypatch):
    """加 type 只改 catalog 注册表时,consumer 提交路径不必再写特判。"""
    from windup_app.server.mq.catalog import TypeSpec, type_specs as live_specs

    extra = TypeSpec(
        msg_type="character_probe",
        stream="windup:stream:generation",
        pool="probe",
        concurrency=1,
        limit=True,
    )
    current = live_specs()
    monkeypatch.setattr(
        "windup_app.server.mq.catalog.type_specs",
        lambda: (*current, extra),
    )

    consumer = StreamConsumer(
        ConsumerConfig(stream="windup:stream:generation", group="generation", concurrency=2),
        run_image_task=MagicMock(),
        run_action_task=MagicMock(),
        stop_event=threading.Event(),
    )
    try:
        fields = {
            "data": json.dumps({
                "v": 1,
                "id": str(uuid.uuid4()),
                "type": "character_probe",
                "payload": {"task_id": 1},
            })
        }
        assert "probe" in consumer._executors
        assert consumer._executor_for(fields) is consumer._executors["probe"]
        assert consumer._semaphore_for("character_probe") is not None
        assert consumer._executor_for(fields) is not consumer._executor
    finally:
        consumer.shutdown()


def test_poll_message_runs_while_image_workers_are_busy(
    engine, worker_session, monkeypatch,
):
    monkeypatch.setenv("WINDUP_MQ_GENERATION_IMAGE_CONCURRENCY", "1")
    monkeypatch.setenv("WINDUP_MQ_GENERATION_POLL_CONCURRENCY", "1")
    _patch_worker_session_local(monkeypatch, engine)

    image_id = uuid.uuid4()
    poll_id = uuid.uuid4()
    mq_repo.insert_pending(
        worker_session,
        message_id=image_id,
        dedupe_key=f"generation:image:{image_id}",
        stream="windup:stream:generation",
        msg_type=MSG_TYPE_CHARACTER_IMAGE,
        payload={"task_id": 1, "task_type": "character_image"},
    )
    mq_repo.mark_published(worker_session, image_id, "i-0")
    mq_repo.insert_pending(
        worker_session,
        message_id=poll_id,
        dedupe_key=f"generation:poll:{poll_id}",
        stream="windup:stream:generation",
        msg_type=MSG_TYPE_CHARACTER_ACTION_POLL,
        payload={"task_id": 2, "task_type": "character_action"},
    )
    mq_repo.mark_published(worker_session, poll_id, "p-0")
    worker_session.commit()

    redis_mock = MagicMock()
    monkeypatch.setattr("windup_app.worker.consumer.get_redis", lambda: redis_mock)

    image_started = threading.Event()
    image_release = threading.Event()
    poll_ran = threading.Event()

    def dispatch(msg_type, payload, **kwargs):
        if msg_type == MSG_TYPE_CHARACTER_IMAGE:
            image_started.set()
            assert image_release.wait(timeout=5)
        elif msg_type == MSG_TYPE_CHARACTER_ACTION_POLL:
            poll_ran.set()

    monkeypatch.setattr("windup_app.worker.consumer.dispatch_handler", dispatch)

    consumer = StreamConsumer(
        ConsumerConfig(stream="windup:stream:generation", group="generation", concurrency=1),
        run_image_task=MagicMock(),
        run_action_task=MagicMock(),
        stop_event=threading.Event(),
        resume_action_poll=MagicMock(),
    )
    try:
        consumer._submit_message("i-0", {"data": json.dumps({
            "v": 1,
            "id": str(image_id),
            "type": MSG_TYPE_CHARACTER_IMAGE,
            "payload": {"task_id": 1, "task_type": "character_image"},
        })})
        assert image_started.wait(timeout=5)
        consumer._submit_message("p-0", {"data": json.dumps({
            "v": 1,
            "id": str(poll_id),
            "type": MSG_TYPE_CHARACTER_ACTION_POLL,
            "payload": {"task_id": 2, "task_type": "character_action"},
        })})
        assert poll_ran.wait(timeout=5), "poll 应在 image 占满共享池时仍能执行"
    finally:
        image_release.set()
        consumer.shutdown()


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
    billing.reserve_for_task(
        db_session, user_id=1, task_id=task.id,
        task_type=GenerationType.CHARACTER_IMAGE, model_calls=1,
    )
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
    billing.reserve_for_task(
        db_session, user_id=1, task_id=task.id,
        task_type=GenerationType.CHARACTER_IMAGE, model_calls=1,
    )
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


def test_consumer_defers_running_task_without_ack(
    engine,
    worker_session,
    db_session,
    monkeypatch,
):
    _patch_worker_session_local(monkeypatch, engine)
    seed_credit_account(db_session, 1)
    db_session.commit()

    service = AiGenerationService()
    task = service.generate_character_image(
        db_session,
        user_id=1,
        project_id=1,
        input=CharacterImageInput(prompt="running"),
    )
    task_repo.update_status(db_session, task.id, TaskStatus.RUNNING)
    db_session.commit()

    message_id = uuid.uuid4()
    mq_repo.insert_pending(
        worker_session,
        message_id=message_id,
        dedupe_key=f"generation:running:{message_id}",
        stream="windup:stream:generation",
        msg_type=MSG_TYPE_CHARACTER_IMAGE,
        payload={"task_id": task.id, "task_type": "character_image"},
    )
    mq_repo.mark_published(worker_session, message_id, "5-0")
    worker_session.commit()

    redis_mock = MagicMock()
    monkeypatch.setattr("windup_app.worker.consumer.get_redis", lambda: redis_mock)

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
        "payload": {"task_id": task.id, "task_type": "character_image"},
    }
    consumer._process_message("5-0", {"data": json.dumps(envelope)})

    redis_mock.xack.assert_not_called()
    row = worker_session.get(MqMessage, message_id)
    worker_session.refresh(row)
    assert row.consume_status is None


def test_consumer_acquires_generation_semaphore(engine, worker_session, monkeypatch):
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
def test_action_input_takes_frames_from_the_convention():
    """MQ 重建入参时缺帧数就按动作类型取,不在这层兜一个自己的数。

    生产走的就是这条重建路径:这里兜的数与约定分叉时,任务照跑、帧照出,没有一处会红。
    """
    from windup_app.server.orchestrator.model import frames_for
    from windup_app.worker.handlers import _action_input

    rebuilt = _action_input({"character_id": 1, "action_type": "idle"})

    assert rebuilt.num_frames == frames_for(ActionType.IDLE)
    assert rebuilt.num_frames != 32


def test_action_input_keeps_the_stored_frame_count():
    """落库的帧数是产线唯一来源,重建时原样取,不拿约定覆盖它。"""
    from windup_app.worker.handlers import _action_input

    rebuilt = _action_input({"character_id": 1, "action_type": "idle", "num_frames": 20})

    assert rebuilt.num_frames == 20


def test_image_input_uses_model_default_when_payload_omits_num_images():
    """MQ 重建入参时缺张数就用 CharacterImageInput 自己的默认值,不在这层另写一份。

    生产走的就是这条重建路径:这里兜 1 而入参默认是 2 时,同一请求经不经过 MQ
    出图张数不同,费用跟着偏,没有一处会红。
    """
    from windup_app.worker.handlers import _image_input

    rebuilt = _image_input({"prompt": "hero"})

    assert rebuilt.num_images == CharacterImageInput().num_images


def test_image_input_keeps_explicit_zero_num_images():
    """显式 0 与没传必须能区分:or 会把 0 吃成另一份默认值。"""
    from windup_app.worker.handlers import _image_input

    rebuilt = _image_input({"prompt": "hero", "num_images": 0})

    assert rebuilt.num_images == 0


def test_warmup_injects_one_matte_into_both_executors(monkeypatch):
    """预热实例必须交给动作/出图执行器,不能 warmup 完丢掉再各 new 一套。"""
    from windup_app.bootstrap import worker as w
    from windup_app.server.orchestrator import executor as ex

    class _Fake:
        warmed = False

        def warmup(self):
            self.warmed = True

    fake = _Fake()
    monkeypatch.setattr(
        "windup_framework.providers.OnnxU2NetMatteProvider", lambda *a, **k: fake
    )
    prev_a, prev_i = ex.executor._matte, ex.image_executor._matte
    try:
        w._warmup_local_inference()
        assert fake.warmed is True
        assert ex.executor._matte is fake
        assert ex.image_executor._matte is fake
    finally:
        ex.executor._matte = prev_a
        ex.image_executor._matte = prev_i
