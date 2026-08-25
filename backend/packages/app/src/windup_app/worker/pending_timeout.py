"""PENDING 排队超时解冻。"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import select

from windup_app.server.mq.catalog import GENERATION_PENDING_MAX_AGE_SECONDS
from windup_app.server.orchestrator import billing, task_repo
from windup_app.server.orchestrator.model import GenerationTaskRecord, TaskStatus
from windup_framework.db.session import SessionLocal

logger = logging.getLogger("windup.worker.pending_timeout")


def release_stale_pending_tasks() -> int:
    """将超过阈值的 PENDING+冻结任务标 FAILED 并解冻。"""
    cutoff = datetime.now(timezone.utc) - timedelta(seconds=GENERATION_PENDING_MAX_AGE_SECONDS)
    session = SessionLocal()
    released = 0
    try:
        rows = session.scalars(
            select(GenerationTaskRecord).where(
                GenerationTaskRecord.status == TaskStatus.PENDING.value,
                GenerationTaskRecord.create_at < cutoff,
            )
        ).all()
        for record in rows:
            if record.id is None:
                continue
            attempt = billing.attempt_for_task(record.task_type, record.input_payload)
            if not billing.has_open_freeze(session, record.id, attempt):
                continue
            task_repo.update_status(
                session,
                record.id,
                TaskStatus.FAILED,
                error_message="排队超时，已解冻积分",
            )
            billing.release_for_task(
                session,
                user_id=record.user_id,
                task_id=record.id,
                attempt=attempt,
            )
            released += 1
            logger.warning("PENDING 排队超时已解冻 | task_id=%s", record.id)
        session.commit()
    except Exception:
        session.rollback()
        logger.exception("PENDING 超时扫描失败")
    finally:
        session.close()
    return released
