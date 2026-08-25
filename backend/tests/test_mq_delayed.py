"""Redis ZSET 延迟队列:到期促进到 Stream,不用 keyspace notification。"""

from __future__ import annotations

import json
from unittest.mock import MagicMock

from windup_framework.mq.config import DELAYED_ZSET_KEY
from windup_framework.mq.delayed import claim_due, promote_due_messages, schedule_delayed


class _MemRedis:
    """够跑 ZADD/HSET/CLAIM Lua 语义的内存桩。"""

    def __init__(self) -> None:
        self.zset: dict[str, float] = {}
        self.hash: dict[str, str] = {}

    def pipeline(self):
        return self

    def zadd(self, key, mapping):
        assert key == DELAYED_ZSET_KEY
        self.zset.update(mapping)
        return self

    def hset(self, key, field, value):
        self.hash[field] = value
        return self

    def execute(self):
        return []

    def eval(self, script, nkeys, zkey, hkey, now, limit):
        now_f = float(now)
        cap = int(limit)
        due = sorted(
            (item_id for item_id, score in self.zset.items() if score <= now_f),
            key=lambda item_id: self.zset[item_id],
        )[:cap]
        out = []
        for item_id in due:
            del self.zset[item_id]
            payload = self.hash.pop(item_id, None)
            if payload is not None:
                out.append(payload)
        return out


def test_schedule_and_claim_due_is_atomic(monkeypatch):
    redis_mem = _MemRedis()
    monkeypatch.setattr("windup_framework.mq.delayed.get_redis", lambda: redis_mem)

    schedule_delayed(
        delay_s=0,
        stream="windup:stream:generation",
        msg_type="character_action_poll",
        payload={"task_id": 7, "poll_count": 0},
        dedupe_key="generation:7:poll:0",
    )
    assert len(redis_mem.zset) == 1
    first = claim_due(now=10**12)
    assert len(first) == 1
    assert first[0]["msg_type"] == "character_action_poll"
    assert first[0]["payload"]["task_id"] == 7
    assert claim_due(now=10**12) == []


def test_future_items_are_not_claimed(monkeypatch):
    redis_mem = _MemRedis()
    monkeypatch.setattr("windup_framework.mq.delayed.get_redis", lambda: redis_mem)
    schedule_delayed(
        delay_s=30,
        stream="windup:stream:generation",
        msg_type="character_action_poll",
        payload={"task_id": 1},
        dedupe_key="generation:1:poll:0",
    )
    assert claim_due(now=0) == []
    assert len(redis_mem.zset) == 1


def test_promote_due_messages_uses_publish_now(monkeypatch):
    redis_mem = _MemRedis()
    monkeypatch.setattr("windup_framework.mq.delayed.get_redis", lambda: redis_mem)
    schedule_delayed(
        delay_s=0,
        stream="windup:stream:generation",
        msg_type="character_action_poll",
        payload={"task_id": 9},
        dedupe_key="generation:9:poll:0",
    )

    published: list[dict] = []

    class _Pub:
        def publish_now(self, session, **kwargs):
            published.append(kwargs)
            return "msg-id"

    monkeypatch.setattr("windup_framework.db.session.SessionLocal", lambda: MagicMock())
    monkeypatch.setattr("windup_framework.mq.publisher.MqPublisher", _Pub)

    assert promote_due_messages(now=10**12) == 1
    assert published[0]["msg_type"] == "character_action_poll"
    assert published[0]["dedupe_key"] == "generation:9:poll:0"
    assert json.dumps(published[0]["payload"])


def test_promote_failure_requeues(monkeypatch):
    redis_mem = _MemRedis()
    monkeypatch.setattr("windup_framework.mq.delayed.get_redis", lambda: redis_mem)
    schedule_delayed(
        delay_s=0,
        stream="windup:stream:generation",
        msg_type="character_action_poll",
        payload={"task_id": 3},
        dedupe_key="generation:3:poll:0",
    )

    class _Boom:
        def publish_now(self, session, **kwargs):
            raise RuntimeError("db down")

    monkeypatch.setattr("windup_framework.db.session.SessionLocal", lambda: MagicMock())
    monkeypatch.setattr("windup_framework.mq.publisher.MqPublisher", _Boom)

    assert promote_due_messages(now=10**12) == 0
    assert len(redis_mem.zset) == 1
