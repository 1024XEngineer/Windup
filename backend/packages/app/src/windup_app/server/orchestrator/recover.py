"""进程重启后对账：有冻结、未终态的生成任务重新入队或失败解冻。

调度载体为 Redis Stream + mq_message outbox。worker 启动时扫描 PENDING/RUNNING
且仍有开放冻结的任务：

- PENDING：通过 publisher 补投（dedupe_key 幂等，不插第二行）
- RUNNING：仅当 update_at 超过 stale 阈值才视为孤儿并 FAILED + 解冻
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session

from windup_app.server.mq.catalog import (
    GENERATION_RUNNING_STALE_SECONDS,
    msg_type_for_generation,
    stream_for_msg_type,
)
from windup_app.server.orchestrator import billing, task_repo
from windup_app.server.mq import i2v_admit
from windup_app.server.orchestrator.i2v_poll import reschedule_if_waiting
from windup_app.server.orchestrator.model import (
    GenerationTask,
    TaskStatus,
)
from windup_framework.mq.publisher import MqPublisher

logger = logging.getLogger("windup.generation.recover")


def recover_orphaned_generation_tasks(
    session: Session,
    *,
    publisher: MqPublisher,
    fail_stale_running: bool = False,
    running_stale_seconds: int = GENERATION_RUNNING_STALE_SECONDS,
) -> None:
    """扫描未结清冻结的开放任务并恢复。调用方负责 commit。"""
    try:
        i2v_admit.rebuild()
    except Exception:
        logger.exception("重建 i2v 在途名额失败")
    stale_cutoff = datetime.now(timezone.utc) - timedelta(seconds=running_stale_seconds)
    for task in task_repo.list_by_status(
        session,
        (TaskStatus.PENDING, TaskStatus.RUNNING),
    ):
        if task.id is None:
            continue
        attempt = billing.attempt_for_task(task.task_type, task.input_payload)
        if not billing.has_open_freeze(session, task.id, attempt):
            _fail_unrecoverable(session, task)
            continue
        if task.status is TaskStatus.RUNNING:
            try:
                if reschedule_if_waiting(task.id):
                    continue
                if i2v_admit.has_claim(task.id):
                    i2v_admit.schedule_retry(task.id, 1)
                    continue
            except Exception:
                logger.exception("检查 i2v 延迟状态失败 | task_id=%s", task.id)
            if not fail_stale_running:
                continue
            updated = task.update_at
            if updated is not None and updated.tzinfo is None:
                updated = updated.replace(tzinfo=timezone.utc)
            if updated is not None and updated >= stale_cutoff:
                continue
            _fail_interrupted(session, task)
            continue
        _requeue_pending(session, publisher, task)


def _fail_unrecoverable(session: Session, task: GenerationTask) -> None:
    """没有冻结可退,也不重跑;只保证它不再停在开放态。"""
    assert task.id is not None
    task_repo.update_status(
        session,
        task.id,
        TaskStatus.FAILED,
        error_message="任务已中断，请重新提交",
    )
    logger.warning("无冻结的开放任务已置为失败 | task_id=%s %s", task.id, task.status)


def _fail_interrupted(session: Session, task: GenerationTask) -> None:
    assert task.id is not None
    task_repo.update_status(
        session,
        task.id,
        TaskStatus.FAILED,
        error_message="进程中断，已解冻积分",
    )
    attempt = billing.attempt_for_task(task.task_type, task.input_payload)
    billing.release_for_task(
        session,
        user_id=task.user_id,
        task_id=task.id,
        attempt=attempt,
    )
    logger.warning("孤儿 RUNNING 任务已失败解冻 | task_id=%s", task.id)


def _requeue_pending(
    session: Session,
    publisher: MqPublisher,
    task: GenerationTask,
) -> None:
    assert task.id is not None
    try:
        task_type = (
            task.task_type.value
            if hasattr(task.task_type, "value")
            else str(task.task_type)
        )
        msg_type = msg_type_for_generation(task_type)
        message_id = publisher.enqueue(
            session,
            stream=stream_for_msg_type(msg_type),
            msg_type=msg_type,
            payload={
                "task_id": task.id,
                "task_type": task_type,
            },
            dedupe_key=_generation_dedupe_key(task),
        )
        publisher.register_after_commit(session, message_id)
    except Exception:
        logger.exception("PENDING 任务重入队失败，改为解冻 | task_id=%s", task.id)
        _fail_interrupted(session, task)
        return
    logger.info("孤儿 PENDING 任务已重入队 | task_id=%s", task.id)


def _generation_dedupe_key(task: GenerationTask) -> str:
    attempt = billing.attempt_for_task(task.task_type, task.input_payload)
    return (
        f"generation:{task.id}"
        if attempt == 0
        else f"generation:{task.id}:retry:{attempt}"
    )
