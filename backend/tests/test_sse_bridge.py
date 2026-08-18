"""SSE Redis 桥接单测。"""

from __future__ import annotations

import json
import time
from unittest.mock import MagicMock

from windup_framework.sse.bridge import (
    InProcessTaskEventBridge,
    RedisTaskEventBridge,
    RedisTaskEventSubscriber,
)


def test_in_process_bridge_forwards_to_callback():
    received: list[tuple[int, int, str, dict]] = []

    bridge = InProcessTaskEventBridge(
        lambda project_id, task_id, event, data: received.append((project_id, task_id, event, data)),
    )
    bridge.publish(7, 42, "progress", {"pct": 50})

    assert received == [(7, 42, "progress", {"pct": 50})]


def test_redis_bridge_publish(monkeypatch):
    redis_mock = MagicMock()
    monkeypatch.setattr("windup_framework.sse.bridge.get_redis", lambda: redis_mock)

    RedisTaskEventBridge(channel="test:channel").publish(1, 2, "done", {"ok": True})

    redis_mock.publish.assert_called_once()
    channel, payload = redis_mock.publish.call_args.args
    assert channel == "test:channel"
    assert json.loads(payload)["event"] == "done"


def test_redis_bridge_publish_failure_is_swallowed(monkeypatch):
    redis_mock = MagicMock()
    redis_mock.publish.side_effect = RuntimeError("redis down")
    monkeypatch.setattr("windup_framework.sse.bridge.get_redis", lambda: redis_mock)

    RedisTaskEventBridge().publish(1, 2, "done", {})


def test_subscriber_forwards_valid_message(monkeypatch):
    received: list[tuple[int, int, str, dict]] = []
    payload = json.dumps(
        {
            "v": 1,
            "project_id": 3,
            "task_id": 9,
            "event": "progress",
            "data": {"pct": 10},
        },
    )

    class FakePubSub:
        def __init__(self) -> None:
            self._calls = 0

        def subscribe(self, _channel: str) -> None:
            return None

        def get_message(self, timeout: float = 1.0):
            self._calls += 1
            if self._calls == 1:
                return {"type": "message", "data": payload}
            return None

        def close(self) -> None:
            return None

    redis_mock = MagicMock()
    redis_mock.pubsub.return_value = FakePubSub()
    monkeypatch.setattr("windup_framework.sse.bridge.get_redis", lambda: redis_mock)

    subscriber = RedisTaskEventSubscriber(
        lambda project_id, task_id, event, data: received.append((project_id, task_id, event, data)),
        channel="test:events",
    )
    subscriber.start()
    deadline = time.time() + 3
    while time.time() < deadline and not received:
        time.sleep(0.05)
    subscriber.stop()

    assert received == [(3, 9, "progress", {"pct": 10})]


def test_subscriber_ignores_invalid_payload(monkeypatch):
    class FakePubSub:
        def subscribe(self, _channel: str) -> None:
            return None

        def get_message(self, timeout: float = 1.0):
            return {"type": "message", "data": "{not-json"}

        def close(self) -> None:
            return None

    redis_mock = MagicMock()
    redis_mock.pubsub.return_value = FakePubSub()
    monkeypatch.setattr("windup_framework.sse.bridge.get_redis", lambda: redis_mock)

    subscriber = RedisTaskEventSubscriber(lambda *_args: (_ for _ in ()).throw(AssertionError("unexpected")))
    subscriber.start()
    time.sleep(0.2)
    subscriber.stop()
