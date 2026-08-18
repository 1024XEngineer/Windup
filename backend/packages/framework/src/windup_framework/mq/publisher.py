"""事务性 outbox 发布器。"""

from __future__ import annotations

import logging
import uuid
from typing import Any

from sqlalchemy import event
from sqlalchemy.orm import Session

from windup_framework.db.redis import get_redis
from windup_framework.mq import client as mq_client
from windup_framework.mq.config import MAX_PUBLISH_ATTEMPTS
from windup_framework.mq import repository as mq_repo

logger = logging.getLogger("windup.mq.publisher")


class MqPublisher:
    """写入 mq_message 并在 commit 后 XADD。"""

    def enqueue(
        self,
        session: Session,
        *,
        stream: str,
        msg_type: str,
        payload: dict[str, Any],
        dedupe_key: str,
    ) -> uuid.UUID:
        """在当前事务内插入 pending 行（幂等）。"""
        existing = mq_repo.get_by_dedupe_key(session, dedupe_key)
        if existing is not None:
            return existing.id

        message_id = uuid.uuid4()
        mq_repo.insert_pending(
            session,
            message_id=message_id,
            dedupe_key=dedupe_key,
            stream=stream,
            msg_type=msg_type,
            payload=payload,
        )
        return message_id

    def register_after_commit(self, session: Session, message_id: uuid.UUID) -> None:
        """注册 after_commit 回调，在事务成功后再投递到 Stream。"""

        @event.listens_for(session, "after_commit", once=True)
        def _after_commit(_session: Session) -> None:
            self.flush_to_stream(message_id)

    def publish_now(
        self,
        session: Session,
        *,
        stream: str,
        msg_type: str,
        payload: dict[str, Any],
        dedupe_key: str,
    ) -> uuid.UUID:
        """短事务：insert + commit + XADD；失败则抛异常。"""
        message_id = self.enqueue(
            session,
            stream=stream,
            msg_type=msg_type,
            payload=payload,
            dedupe_key=dedupe_key,
        )
        session.commit()
        self.flush_to_stream(message_id)
        return message_id

    def flush_to_stream(self, message_id: uuid.UUID) -> bool:
        """将 pending 消息 XADD 到 Redis Stream。"""
        from windup_framework.db.session import SessionLocal

        session = SessionLocal()
        try:
            row = mq_repo.get_by_id(session, message_id)
            if row is None:
                logger.warning("flush_to_stream: 消息不存在 | id=%s", message_id)
                return False
            if row.publish_status == "published" and row.stream_id:
                return True

            envelope = {
                "v": 1,
                "id": str(row.id),
                "type": row.msg_type,
                "payload": row.payload,
            }
            redis_client = get_redis()
            stream_id = mq_client.xadd_message(redis_client, row.stream, envelope)
            mq_repo.mark_published(session, row.id, stream_id)
            session.commit()
            logger.debug(
                "消息已投递 | id=%s stream=%s stream_id=%s",
                row.id,
                row.stream,
                stream_id,
            )
            return True
        except Exception as exc:
            session.rollback()
            logger.exception("XADD 失败 | id=%s", message_id)
            self._record_publish_failure(message_id, str(exc))
            return False
        finally:
            session.close()

    def _record_publish_failure(self, message_id: uuid.UUID, error: str) -> None:
        from windup_framework.db.session import SessionLocal

        session = SessionLocal()
        try:
            row = mq_repo.get_by_id(session, message_id)
            if row is None:
                return
            terminal = row.publish_attempts + 1 >= MAX_PUBLISH_ATTEMPTS
            mq_repo.mark_publish_failed(session, message_id, error, terminal=terminal)
            session.commit()
        except Exception:
            session.rollback()
            logger.exception("记录 publish 失败时出错 | id=%s", message_id)
        finally:
            session.close()
