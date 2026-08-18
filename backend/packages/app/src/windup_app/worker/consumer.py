"""Stream 消费者循环。"""

from __future__ import annotations

import logging
import socket
import threading
import uuid
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from typing import Any

from windup_app.server.mq.catalog import (
    MSG_TYPE_CHARACTER_ACTION,
    MSG_TYPE_CHARACTER_IMAGE,
    StreamSpec,
    generation_action_concurrency,
    generation_image_concurrency,
)
from windup_app.worker.handlers import dispatch_handler, should_skip_message
from windup_framework.db.redis import get_redis
from windup_framework.db.session import SessionLocal
from windup_framework.mq import client as mq_client
from windup_framework.mq.config import MAX_CONSUME_ATTEMPTS
from windup_framework.mq import repository as mq_repo
from windup_framework.mq.publisher import MqPublisher

logger = logging.getLogger("windup.worker.consumer")


@dataclass(frozen=True)
class ConsumerConfig:
    stream: str
    group: str
    concurrency: int


class StreamConsumer:
    """单 Stream 的 XREADGROUP 消费循环。"""

    def __init__(
        self,
        config: StreamSpec | ConsumerConfig,
        *,
        run_image_task: Callable[..., Any],
        run_action_task: Callable[..., Any],
        stop_event: threading.Event,
    ) -> None:
        self._config = config
        self._run_image_task = run_image_task
        self._run_action_task = run_action_task
        self._stop = stop_event
        self._consumer_name = f"{socket.gethostname()}-{threading.get_ident()}"
        self._executor = ThreadPoolExecutor(
            max_workers=config.concurrency,
            thread_name_prefix=f"windup-{config.group}",
        )
        self._image_sem = threading.Semaphore(generation_image_concurrency())
        self._action_sem = threading.Semaphore(generation_action_concurrency())
        self._in_flight = 0
        self._in_flight_lock = threading.Lock()

    def start(self) -> threading.Thread:
        thread = threading.Thread(
            target=self._loop,
            name=f"windup-consumer-{self._config.group}",
            daemon=True,
        )
        thread.start()
        return thread

    def shutdown(self, *, wait_timeout: float = 30.0) -> None:
        self._executor.shutdown(wait=True, cancel_futures=False)

    def _loop(self) -> None:
        redis_client = get_redis()
        mq_client.ensure_consumer_group(
            redis_client,
            self._config.stream,
            self._config.group,
        )
        self._claim_idle(redis_client)

        while not self._stop.is_set():
            try:
                batches = mq_client.xreadgroup(
                    redis_client,
                    group=self._config.group,
                    consumer=self._consumer_name,
                    streams={self._config.stream: ">"},
                    count=1,
                    block_ms=1000,
                )
            except Exception:
                logger.exception("XREADGROUP 失败 | stream=%s", self._config.stream)
                continue

            for _stream, messages in batches:
                for stream_id, fields in messages:
                    self._executor.submit(self._process_message, stream_id, fields)

    def _claim_idle(self, redis_client) -> None:
        claimed = mq_client.claim_idle_messages(
            redis_client,
            self._config.stream,
            self._config.group,
            self._consumer_name,
        )
        for stream_id, fields in claimed:
            self._executor.submit(self._process_message, stream_id, fields)

    def _process_message(self, stream_id: str, fields: dict[str, str]) -> None:
        redis_client = get_redis()
        semaphores: list[threading.Semaphore] = []
        try:
            envelope = mq_client.parse_envelope(fields)
            message_id = uuid.UUID(str(envelope["id"]))
            msg_type = str(envelope["type"])
            payload = dict(envelope.get("payload") or {})

            sem = self._semaphore_for(msg_type)
            if sem is not None:
                sem.acquire()
                semaphores.append(sem)

            session = SessionLocal()
            try:
                if should_skip_message(session, message_id):
                    session.commit()
                    mq_client.xack(
                        redis_client,
                        self._config.stream,
                        self._config.group,
                        stream_id,
                    )
                    return

                mq_repo.increment_consume_attempts(session, message_id)
                session.commit()
            finally:
                session.close()

            dispatch_handler(
                msg_type,
                payload,
                run_image_task=self._run_image_task,
                run_action_task=self._run_action_task,
            )

            session = SessionLocal()
            try:
                mq_repo.mark_consumed(session, message_id, "acked")
                session.commit()
            finally:
                session.close()
            mq_client.xack(
                redis_client,
                self._config.stream,
                self._config.group,
                stream_id,
            )
        except Exception as exc:
            logger.exception(
                "消息处理失败 | stream=%s stream_id=%s",
                self._config.stream,
                stream_id,
            )
            self._handle_failure(stream_id, fields, exc)
        finally:
            for sem in semaphores:
                sem.release()

    def _semaphore_for(self, msg_type: str) -> threading.Semaphore | None:
        if msg_type == MSG_TYPE_CHARACTER_IMAGE:
            return self._image_sem
        if msg_type == MSG_TYPE_CHARACTER_ACTION:
            return self._action_sem
        return None

    def _handle_failure(
        self,
        stream_id: str,
        fields: dict[str, str],
        exc: Exception,
    ) -> None:
        redis_client = get_redis()
        message_id: uuid.UUID | None = None
        try:
            envelope = mq_client.parse_envelope(fields)
            message_id = uuid.UUID(str(envelope["id"]))
        except Exception:
            logger.exception("解析失败消息 envelope 出错")

        session = SessionLocal()
        try:
            if message_id is not None:
                row = mq_repo.get_by_id(session, message_id)
                if row is not None and row.consume_attempts >= MAX_CONSUME_ATTEMPTS:
                    mq_repo.mark_consumed(session, message_id, "failed", error=str(exc))
                    session.commit()
                    mq_client.xack(
                        redis_client,
                        self._config.stream,
                        self._config.group,
                        stream_id,
                    )
                    return
            session.commit()
        finally:
            session.close()


def start_relay_loop(stop_event: threading.Event) -> threading.Thread:
    """周期性 relay pending 消息。"""

    def _run() -> None:
        publisher = MqPublisher()
        while not stop_event.wait(timeout=30):
            try:
                from windup_framework.mq.relay import relay_pending_messages

                relay_pending_messages()
            except Exception:
                logger.exception("relay 循环失败")

    thread = threading.Thread(target=_run, name="windup-mq-relay", daemon=True)
    thread.start()
    return thread
