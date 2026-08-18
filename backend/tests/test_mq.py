"""MQ publisher / relay / client 单元测试。"""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock

import pytest
import redis
from sqlalchemy.orm import sessionmaker

from windup_framework.db.base import Base
from windup_framework.mq import client as mq_client
from windup_framework.mq.config import MAX_PUBLISH_ATTEMPTS
from windup_framework.mq.model import MqMessage
from windup_framework.mq.publisher import MqPublisher
from windup_framework.mq.relay import relay_pending_messages
from windup_framework.mq import repository as mq_repo
from windup_framework.mq.repository import ConsumeClaimResult


@pytest.fixture()
def mq_session(engine):
    Base.metadata.create_all(engine, tables=[MqMessage.__table__])
    session_local = sessionmaker(bind=engine, expire_on_commit=False)
    session = session_local()
    try:
        yield session
    finally:
        session.close()


def test_publish_enqueue_is_idempotent(mq_session):
    publisher = MqPublisher()
    dedupe = "generation:42"
    first = publisher.enqueue(
        mq_session,
        stream="windup:stream:generation",
        msg_type="character_image",
        payload={"task_id": 42, "task_type": "character_image"},
        dedupe_key=dedupe,
    )
    second = publisher.enqueue(
        mq_session,
        stream="windup:stream:generation",
        msg_type="character_image",
        payload={"task_id": 42, "task_type": "character_image"},
        dedupe_key=dedupe,
    )
    assert first == second
    mq_session.commit()
    rows = mq_session.query(MqMessage).all()
    assert len(rows) == 1


def test_flush_to_stream_marks_published(mq_session, engine, monkeypatch):
    message_id = uuid.uuid4()
    mq_repo.insert_pending(
        mq_session,
        message_id=message_id,
        dedupe_key="email:login:a@x.com:1",
        stream="windup:stream:email",
        msg_type="verification_code",
        payload={"email": "a@x.com", "purpose": "login"},
    )
    mq_session.commit()

    session_local = sessionmaker(bind=engine, expire_on_commit=False)
    monkeypatch.setattr("windup_framework.db.session.SessionLocal", session_local)

    redis_mock = MagicMock()
    redis_mock.xadd.return_value = "1734512345678-0"
    monkeypatch.setattr("windup_framework.mq.publisher.get_redis", lambda: redis_mock)

    publisher = MqPublisher()
    assert publisher.flush_to_stream(message_id) is True

    verify = session_local()
    try:
        check = verify.get(MqMessage, message_id)
        assert check is not None
        assert check.publish_status == "published"
        assert check.stream_id == "1734512345678-0"
    finally:
        verify.close()


def test_try_claim_for_consume_is_exclusive(mq_session):
    message_id = uuid.uuid4()
    mq_repo.insert_pending(
        mq_session,
        message_id=message_id,
        dedupe_key="generation:99",
        stream="windup:stream:generation",
        msg_type="character_image",
        payload={"task_id": 99},
    )
    row = mq_session.get(MqMessage, message_id)
    row.publish_status = "published"
    mq_session.commit()

    first = mq_repo.try_claim_for_consume(mq_session, message_id)
    mq_session.commit()
    second = mq_repo.try_claim_for_consume(mq_session, message_id)
    mq_session.commit()

    assert first is ConsumeClaimResult.CLAIMED
    assert second is ConsumeClaimResult.IN_FLIGHT


def _patch_session_local(monkeypatch, engine):
    session_local = sessionmaker(bind=engine, expire_on_commit=False)
    monkeypatch.setattr("windup_framework.db.session.SessionLocal", session_local)
    monkeypatch.setattr("windup_framework.mq.relay.SessionLocal", session_local)
    return session_local


def _mock_redis_xadd(monkeypatch, stream_id: str = "1734512345678-0"):
    redis_mock = MagicMock()
    redis_mock.xadd.return_value = stream_id
    monkeypatch.setattr("windup_framework.mq.publisher.get_redis", lambda: redis_mock)
    return redis_mock


def test_publish_now_commits_and_flushes(mq_session, engine, monkeypatch):
    _patch_session_local(monkeypatch, engine)
    _mock_redis_xadd(monkeypatch)

    publisher = MqPublisher()
    message_id = publisher.publish_now(
        mq_session,
        stream="windup:stream:email",
        msg_type="verification_code",
        payload={"email": "a@x.com", "purpose": "login"},
        dedupe_key="email:login:a@x.com:2",
    )

    row = mq_session.get(MqMessage, message_id)
    assert row is not None
    assert row.publish_status == "published"
    assert row.stream_id == "1734512345678-0"


def test_register_after_commit_flushes_on_commit(mq_session, engine, monkeypatch):
    _patch_session_local(monkeypatch, engine)
    _mock_redis_xadd(monkeypatch)

    publisher = MqPublisher()
    message_id = publisher.enqueue(
        mq_session,
        stream="windup:stream:email",
        msg_type="verification_code",
        payload={"email": "b@x.com", "purpose": "register"},
        dedupe_key="email:register:b@x.com:1",
    )
    publisher.register_after_commit(mq_session, message_id)
    mq_session.commit()

    row = mq_session.get(MqMessage, message_id)
    assert row.publish_status == "published"


def test_flush_to_stream_already_published_is_noop(mq_session, engine, monkeypatch):
    message_id = uuid.uuid4()
    mq_repo.insert_pending(
        mq_session,
        message_id=message_id,
        dedupe_key="generation:100",
        stream="windup:stream:generation",
        msg_type="character_image",
        payload={"task_id": 100},
    )
    mq_repo.mark_published(mq_session, message_id, "999-0")
    mq_session.commit()

    _patch_session_local(monkeypatch, engine)
    redis_mock = _mock_redis_xadd(monkeypatch)

    publisher = MqPublisher()
    assert publisher.flush_to_stream(message_id) is True
    redis_mock.xadd.assert_not_called()


def test_flush_to_stream_missing_message_returns_false(mq_session, engine, monkeypatch):
    _patch_session_local(monkeypatch, engine)
    _mock_redis_xadd(monkeypatch)

    publisher = MqPublisher()
    assert publisher.flush_to_stream(uuid.uuid4()) is False


def test_flush_to_stream_xadd_failure_records_attempt(mq_session, engine, monkeypatch):
    message_id = uuid.uuid4()
    mq_repo.insert_pending(
        mq_session,
        message_id=message_id,
        dedupe_key="email:login:c@x.com:1",
        stream="windup:stream:email",
        msg_type="verification_code",
        payload={"email": "c@x.com", "purpose": "login"},
    )
    mq_session.commit()

    _patch_session_local(monkeypatch, engine)
    redis_mock = MagicMock()
    redis_mock.xadd.side_effect = redis.ConnectionError("redis down")
    monkeypatch.setattr("windup_framework.mq.publisher.get_redis", lambda: redis_mock)

    publisher = MqPublisher()
    assert publisher.flush_to_stream(message_id) is False

    verify = mq_session.get(MqMessage, message_id)
    assert verify.publish_attempts == 1
    assert verify.publish_error is not None


def test_flush_to_stream_terminal_publish_failure(mq_session, engine, monkeypatch):
    message_id = uuid.uuid4()
    mq_repo.insert_pending(
        mq_session,
        message_id=message_id,
        dedupe_key="email:login:d@x.com:1",
        stream="windup:stream:email",
        msg_type="verification_code",
        payload={"email": "d@x.com", "purpose": "login"},
    )
    row = mq_session.get(MqMessage, message_id)
    row.publish_attempts = MAX_PUBLISH_ATTEMPTS - 1
    mq_session.commit()

    session_local = _patch_session_local(monkeypatch, engine)
    redis_mock = MagicMock()
    redis_mock.xadd.side_effect = redis.ConnectionError("redis down")
    monkeypatch.setattr("windup_framework.mq.publisher.get_redis", lambda: redis_mock)

    publisher = MqPublisher()
    assert publisher.flush_to_stream(message_id) is False

    verify = session_local()
    try:
        row = verify.get(MqMessage, message_id)
        assert row.publish_status == "failed"
    finally:
        verify.close()


def test_relay_pending_messages(mq_session, engine, monkeypatch):
    for idx in range(2):
        mq_repo.insert_pending(
            mq_session,
            message_id=uuid.uuid4(),
            dedupe_key=f"email:login:relay{idx}@x.com:1",
            stream="windup:stream:email",
            msg_type="verification_code",
            payload={"email": f"relay{idx}@x.com", "purpose": "login"},
        )
    mq_session.commit()

    _patch_session_local(monkeypatch, engine)
    _mock_redis_xadd(monkeypatch)

    assert relay_pending_messages(limit=10) == 2


def test_list_pending_respects_limit(mq_session):
    for idx in range(3):
        mq_repo.insert_pending(
            mq_session,
            message_id=uuid.uuid4(),
            dedupe_key=f"generation:list:{idx}",
            stream="windup:stream:generation",
            msg_type="character_image",
            payload={"task_id": idx},
        )
    mq_session.commit()

    pending = mq_repo.list_pending(mq_session, limit=2)
    assert len(pending) == 2


def test_try_claim_for_consume_missing_returns_already_done(mq_session):
    result = mq_repo.try_claim_for_consume(mq_session, uuid.uuid4())
    assert result is ConsumeClaimResult.ALREADY_DONE


def test_try_claim_for_consume_terminal_status_returns_already_done(mq_session):
    message_id = uuid.uuid4()
    mq_repo.insert_pending(
        mq_session,
        message_id=message_id,
        dedupe_key="generation:done",
        stream="windup:stream:generation",
        msg_type="character_image",
        payload={"task_id": 1},
    )
    mq_repo.mark_consumed(mq_session, message_id, "acked")
    mq_session.commit()

    assert mq_repo.try_claim_for_consume(mq_session, message_id) is ConsumeClaimResult.ALREADY_DONE


def test_try_claim_reclaims_stale_processing(mq_session):
    message_id = uuid.uuid4()
    mq_repo.insert_pending(
        mq_session,
        message_id=message_id,
        dedupe_key="generation:stale",
        stream="windup:stream:generation",
        msg_type="character_image",
        payload={"task_id": 2},
    )
    row = mq_session.get(MqMessage, message_id)
    row.consume_status = "processing"
    row.updated_at = datetime.now(timezone.utc) - timedelta(hours=1)
    mq_session.commit()

    result = mq_repo.try_claim_for_consume(mq_session, message_id, lease_seconds=60)
    assert result is ConsumeClaimResult.CLAIMED


def test_mark_consumed_and_release_processing_claim(mq_session):
    message_id = uuid.uuid4()
    mq_repo.insert_pending(
        mq_session,
        message_id=message_id,
        dedupe_key="generation:release",
        stream="windup:stream:generation",
        msg_type="character_image",
        payload={"task_id": 3},
    )
    row = mq_session.get(MqMessage, message_id)
    row.consume_status = "processing"
    mq_session.commit()

    mq_repo.release_processing_claim(mq_session, message_id)
    mq_session.commit()
    assert mq_session.get(MqMessage, message_id).consume_status is None

    mq_repo.mark_consumed(mq_session, message_id, "failed", error="boom")
    mq_session.commit()
    failed = mq_session.get(MqMessage, message_id)
    assert failed.consume_status == "failed"
    assert failed.consume_error == "boom"


def test_mark_publish_failed_truncates_long_error(mq_session):
    message_id = uuid.uuid4()
    mq_repo.insert_pending(
        mq_session,
        message_id=message_id,
        dedupe_key="generation:truncate",
        stream="windup:stream:generation",
        msg_type="character_image",
        payload={"task_id": 4},
    )
    mq_repo.mark_publish_failed(mq_session, message_id, "x" * 3000, terminal=True)
    mq_session.commit()

    row = mq_session.get(MqMessage, message_id)
    assert row.publish_status == "failed"
    assert row.publish_error is not None
    assert len(row.publish_error) <= 2048


def test_ensure_consumer_group_ignores_busygroup():
    redis_mock = MagicMock()
    redis_mock.xgroup_create.side_effect = redis.ResponseError("BUSYGROUP already exists")

    mq_client.ensure_consumer_group(redis_mock, "stream", "group")
    redis_mock.xgroup_create.assert_called_once()


def test_ensure_consumer_group_reraises_other_errors():
    redis_mock = MagicMock()
    redis_mock.xgroup_create.side_effect = redis.ResponseError("NOGROUP missing")

    with pytest.raises(redis.ResponseError, match="NOGROUP"):
        mq_client.ensure_consumer_group(redis_mock, "stream", "group")


def test_xadd_message_serializes_envelope():
    redis_mock = MagicMock()
    redis_mock.xadd.return_value = "1-0"

    stream_id = mq_client.xadd_message(
        redis_mock,
        "windup:stream:email",
        {"v": 1, "id": "abc", "type": "verification_code", "payload": {"email": "a@x.com"}},
    )

    assert stream_id == "1-0"


def test_xreadgroup_empty_returns_empty_list():
    redis_mock = MagicMock()
    redis_mock.xreadgroup.return_value = None

    assert mq_client.xreadgroup(
        redis_mock,
        group="email",
        consumer="c1",
        streams={"windup:stream:email": ">"},
    ) == []


def test_claim_idle_messages_parses_xautoclaim_result():
    redis_mock = MagicMock()
    redis_mock.xautoclaim.return_value = (
        "2-0",
        [("1-0", {"data": json.dumps({"v": 1})})],
    )

    messages, next_start = mq_client.claim_idle_messages(
        redis_mock,
        "windup:stream:email",
        "email",
        "c1",
    )

    assert next_start == "2-0"
    assert messages == [("1-0", {"data": json.dumps({"v": 1})})]


def test_claim_idle_messages_swallows_response_error():
    redis_mock = MagicMock()
    redis_mock.xautoclaim.side_effect = redis.ResponseError("NOGROUP")

    messages, next_start = mq_client.claim_idle_messages(
        redis_mock,
        "windup:stream:email",
        "email",
        "c1",
        start_id="9-0",
    )

    assert messages == []
    assert next_start == "9-0"


def test_parse_envelope_roundtrip():
    envelope = {"v": 1, "id": "abc", "type": "verification_code", "payload": {"email": "a@x.com"}}
    parsed = mq_client.parse_envelope({"data": json.dumps(envelope)})
    assert parsed == envelope


def test_parse_envelope_requires_data_field():
    with pytest.raises(ValueError, match="缺少 data"):
        mq_client.parse_envelope({})
