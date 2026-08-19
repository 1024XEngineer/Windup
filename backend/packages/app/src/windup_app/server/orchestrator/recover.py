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
    GENERATION_STREAM,
    MSG_TYPE_CHARACTER_ACTION,
    MSG_TYPE_CHARACTER_IMAGE,
)
from windup_app.server.orchestrator import billing, task_repo
from windup_app.server.orchestrator.model import (
    GenerationTask,
    GenerationType,
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
    stale_cutoff = datetime.now(timezone.utc) - timedelta(seconds=running_stale_seconds)
    for task in task_repo.list_by_status(
        session, (TaskStatus.PENDING, TaskStatus.RUNNING),
    ):
        if task.id is None:
            continue
        if not billing.has_open_freeze(session, task.id):
            _fail_unrecoverable(session, task)
            continue
        if task.status is TaskStatus.RUNNING:
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
        session, task.id, TaskStatus.FAILED,
        error_message="任务已中断，请重新提交",
    )
    logger.warning("无冻结的开放任务已置为失败 | task_id=%s %s", task.id, task.status)


def _fail_interrupted(session: Session, task: GenerationTask) -> None:
    assert task.id is not None
    task_repo.update_status(
        session, task.id, TaskStatus.FAILED,
        error_message="进程中断，已解冻积分",
    )
    billing.release_for_task(session, user_id=task.user_id, task_id=task.id)
    logger.warning("孤儿 RUNNING 任务已失败解冻 | task_id=%s", task.id)


def _requeue_pending(
    session: Session,
    publisher: MqPublisher,
    task: GenerationTask,
) -> None:
    assert task.id is not None
    try:
        if task.task_type is GenerationType.CHARACTER_IMAGE:
            msg_type = MSG_TYPE_CHARACTER_IMAGE
        elif task.task_type is GenerationType.CHARACTER_ACTION:
            msg_type = MSG_TYPE_CHARACTER_ACTION
        else:
            raise ValueError(f"未知任务类型: {task.task_type}")
        message_id = publisher.enqueue(
            session,
            stream=GENERATION_STREAM,
            msg_type=msg_type,
            payload={
                "task_id": task.id,
                "task_type": (
                    task.task_type.value
                    if hasattr(task.task_type, "value")
                    else str(task.task_type)
                ),
            },
            dedupe_key=f"generation:{task.id}",
        )
        publisher.register_after_commit(session, message_id)
    except Exception:
        logger.exception("PENDING 任务重入队失败，改为解冻 | task_id=%s", task.id)
        _fail_interrupted(session, task)
        return
    logger.info("孤儿 PENDING 任务已重入队 | task_id=%s", task.id)
