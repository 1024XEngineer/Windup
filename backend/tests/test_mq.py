"""MQ publisher / relay 单元测试。"""

from __future__ import annotations

import uuid
from unittest.mock import MagicMock, patch

import pytest
from sqlalchemy.orm import sessionmaker

from windup_framework.db.base import Base
from windup_framework.mq.model import MqMessage
from windup_framework.mq.publisher import MqPublisher
from windup_framework.mq import repository as mq_repo


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
