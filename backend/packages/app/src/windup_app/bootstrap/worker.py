"""Worker 进程装配入口（composition root）。"""

from __future__ import annotations

import logging
import signal
import threading
import time

from windup_app.server.mq.catalog import all_stream_specs, email_stream_spec, generation_stream_spec
from windup_app.server.orchestrator import task_repo
from windup_app.server.orchestrator.executor import (
    bind_matte,
    resume_action_poll,
    run_action_task,
    run_image_task,
    run_direction_set_task,
)
from windup_app.server.orchestrator.recover import recover_orphaned_generation_tasks
from windup_app.worker.consumer import StreamConsumer, start_delayed_loop, start_relay_loop
from windup_app.worker.pending_timeout import release_stale_pending_tasks
from windup_framework.db import Base, SessionLocal, engine
from windup_framework.mq.model import MqMessage  # noqa: F401 — register metadata
from windup_framework.mq.publisher import MqPublisher
from windup_framework.mq.relay import relay_pending_messages
from windup_framework.sse.bridge import RedisTaskEventBridge

logger = logging.getLogger("windup.worker")


def _recover_on_start(publisher: MqPublisher) -> None:
    session = SessionLocal()
    try:
        recover_orphaned_generation_tasks(
            session,
            publisher=publisher,
            fail_stale_running=True,
        )
        session.commit()
    except Exception:
        session.rollback()
        logger.exception("启动对账失败")
    finally:
        session.close()


def main() -> None:
    logging.basicConfig(level=logging.INFO)
    Base.metadata.create_all(engine)

    task_repo.bind_task_event_publisher(RedisTaskEventBridge())
    publisher = MqPublisher()

    _recover_on_start(publisher)
    relay_pending_messages()
    release_stale_pending_tasks()
    _warmup_local_inference()

    stop_event = threading.Event()

    def _handle_signal(_signum, _frame) -> None:
        logger.info("收到退出信号，准备停止 worker …")
        stop_event.set()

    signal.signal(signal.SIGTERM, _handle_signal)
    signal.signal(signal.SIGINT, _handle_signal)

    consumers = [
        StreamConsumer(
            email_stream_spec(),
            run_image_task=run_image_task,
            run_action_task=run_action_task,
            run_direction_set_task=run_direction_set_task,
            stop_event=stop_event,
        ),
        StreamConsumer(
            generation_stream_spec(),
            run_image_task=run_image_task,
            run_action_task=run_action_task,
            run_direction_set_task=run_direction_set_task,
            stop_event=stop_event,
            resume_action_poll=resume_action_poll,
        ),
    ]
    threads = [consumer.start() for consumer in consumers]
    relay_thread = start_relay_loop(stop_event)
    delayed_thread = start_delayed_loop(stop_event)

    pending_thread = threading.Thread(
        target=_pending_timeout_loop,
        args=(stop_event,),
        name="windup-pending-timeout",
        daemon=True,
    )
    pending_thread.start()

    logger.info("windup worker 已启动 | streams=%s", [s.stream for s in all_stream_specs()])

    try:
        while not stop_event.is_set():
            time.sleep(1)
    finally:
        stop_event.set()
        for consumer in consumers:
            consumer.shutdown()
        for thread in threads:
            thread.join(timeout=5)
        relay_thread.join(timeout=5)
        delayed_thread.join(timeout=5)
        pending_thread.join(timeout=5)
        logger.info("windup worker 已停止")


def _warmup_local_inference() -> None:
    """顺序预热抽帧 / 抠图依赖,把 .so 和 onnx 一次读进页缓存。

    首个动作任务再惰性加载时,会和并发 handler、同一块云盘上的 Postgres/Redis
    叠成 IOPS 脉冲。预热失败不挡启动,只记一条日志。
    """
    try:
        import imageio.v3  # noqa: F401
        import av  # noqa: F401
    except Exception:
        logger.warning("抽帧后端预热失败", exc_info=True)
    try:
        from windup_framework.providers import OnnxU2NetMatteProvider

        matte = OnnxU2NetMatteProvider()
        matte.warmup()
        bind_matte(matte)
        logger.info("ONNX 抠图会话已预热")
    except Exception:
        logger.warning("ONNX 预热失败,首个抠图任务会再加载", exc_info=True)


def _pending_timeout_loop(stop_event: threading.Event) -> None:
    while not stop_event.wait(timeout=300):
        try:
            release_stale_pending_tasks()
        except Exception:
            logger.exception("PENDING 超时循环失败")


if __name__ == "__main__":
    main()
