"""任务事件跨进程桥接：worker publish → web subscribe → EventBus。"""

from __future__ import annotations

import json
import logging
import os
import threading
from typing import Callable, Protocol

from windup_framework.db.redis import get_redis

logger = logging.getLogger("windup.sse.bridge")

SSE_REDIS_CHANNEL = os.getenv(
    "WINDUP_SSE_REDIS_CHANNEL",
    "windup:pubsub:generation-task-events",
)


class TaskEventPublisher(Protocol):
    def publish(
        self,
        project_id: int,
        task_id: int,
        event: str,
        data: dict,
    ) -> None:
        ...


class RedisTaskEventBridge:
    """将任务事件发布到 Redis Pub/Sub channel。"""

    def __init__(self, channel: str = SSE_REDIS_CHANNEL) -> None:
        self._channel = channel

    def publish(
        self,
        project_id: int,
        task_id: int,
        event: str,
        data: dict,
    ) -> None:
        payload = json.dumps(
            {
                "v": 1,
                "project_id": project_id,
                "task_id": task_id,
                "event": event,
                "data": data,
            },
            ensure_ascii=False,
        )
        try:
            get_redis().publish(self._channel, payload)
        except Exception:
            logger.exception(
                "TaskEventBridge publish 失败 | task_id=%d event=%s",
                task_id,
                event,
            )


class InProcessTaskEventBridge:
    """测试或无 Redis 时直接回调 EventBus。"""

    def __init__(
        self,
        callback: Callable[[int, int, str, dict], None],
    ) -> None:
        self._callback = callback

    def publish(
        self,
        project_id: int,
        task_id: int,
        event: str,
        data: dict,
    ) -> None:
        self._callback(project_id, task_id, event, data)


class RedisTaskEventSubscriber:
    """后台线程订阅 Redis channel 并转发到回调。"""

    def __init__(
        self,
        callback: Callable[[int, int, str, dict], None],
        *,
        channel: str = SSE_REDIS_CHANNEL,
    ) -> None:
        self._channel = channel
        self._callback = callback
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    def start(self) -> None:
        if self._thread is not None and self._thread.is_alive():
            return
        self._stop.clear()
        self._thread = threading.Thread(
            target=self._run,
            name="windup-sse-subscriber",
            daemon=True,
        )
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout=5)
            self._thread = None

    def _run(self) -> None:
        redis_client = get_redis()
        pubsub = redis_client.pubsub(ignore_subscribe_messages=True)
        pubsub.subscribe(self._channel)
        logger.info("SSE Subscriber 已启动 | channel=%s", self._channel)
        try:
            while not self._stop.is_set():
                message = pubsub.get_message(timeout=1.0)
                if not message or message.get("type") != "message":
                    continue
                raw = message.get("data")
                if raw is None:
                    continue
                if isinstance(raw, bytes):
                    raw = raw.decode()
                try:
                    envelope = json.loads(raw)
                    self._callback(
                        int(envelope["project_id"]),
                        int(envelope["task_id"]),
                        str(envelope["event"]),
                        dict(envelope["data"]),
                    )
                except Exception:
                    logger.exception("SSE Subscriber 解析消息失败")
        finally:
            pubsub.close()
            logger.info("SSE Subscriber 已停止")
