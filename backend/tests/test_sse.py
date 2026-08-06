"""SSE（任务进度推送）单元测试。

覆盖 generation.py 中内嵌的 _EventBus:
- subscribe / unsubscribe / publish 纯内存发布订阅
- 跨频道隔离
- 多订阅者广播
"""

from __future__ import annotations

import asyncio

import pytest

from windup_app.web.api.generation import event_bus


@pytest.fixture(autouse=True)
def _clean_bus():
    """每个测试前清空 EventBus，避免测试间串扰。"""
    event_bus._queues.clear()
    yield
    event_bus._queues.clear()


class TestEventBus:
    """_EventBus 内存发布-订阅。"""

    async def test_subscribe_returns_queue(self):
        queue = await event_bus.subscribe(1)
        assert isinstance(queue, asyncio.Queue)
        assert queue.empty()

    async def test_publish_delivers_to_subscriber(self):
        queue = await event_bus.subscribe(1)
        event_bus.publish(1, "progress", {"step": 1})

        event, data = await asyncio.wait_for(queue.get(), timeout=1.0)
        assert event == "progress"
        assert data == {"step": 1}

    async def test_publish_does_not_cross_channels(self):
        q1 = await event_bus.subscribe(1)
        q2 = await event_bus.subscribe(2)

        event_bus.publish(1, "progress", {"step": 1})

        assert not q1.empty()
        assert q2.empty()

    async def test_multiple_subscribers_receive_same_event(self):
        q1 = await event_bus.subscribe(1)
        q2 = await event_bus.subscribe(1)

        event_bus.publish(1, "completed", {})

        e1, d1 = await asyncio.wait_for(q1.get(), timeout=1.0)
        e2, d2 = await asyncio.wait_for(q2.get(), timeout=1.0)
        assert e1 == "completed"
        assert e2 == "completed"

    async def test_unsubscribe_removes_subscriber(self):
        queue = await event_bus.subscribe(1)
        await event_bus.unsubscribe(1, queue)

        event_bus.publish(1, "progress", {"step": 1})
        assert queue.empty()

    async def test_unsubscribe_nonexistent_is_noop(self):
        queue = asyncio.Queue()
        await event_bus.unsubscribe(999, queue)  # 不抛异常

    async def test_unsubscribe_last_removes_channel(self):
        queue = await event_bus.subscribe(1)
        await event_bus.unsubscribe(1, queue)
        # 频道已清理，新订阅者不影响
        q2 = await event_bus.subscribe(1)
        event_bus.publish(1, "progress", {})
        assert not q2.empty()

    async def test_publish_terminal_event(self):
        """终态事件（completed/failed）应能正常发布。"""
        queue = await event_bus.subscribe(1)

        event_bus.publish(1, "completed", {"result": "ok"})
        e, d = await asyncio.wait_for(queue.get(), timeout=1.0)
        assert e == "completed"
        assert d == {"result": "ok"}

        event_bus.publish(1, "failed", {"error": "timeout"})
        e, d = await asyncio.wait_for(queue.get(), timeout=1.0)
        assert e == "failed"
        assert d == {"error": "timeout"}
