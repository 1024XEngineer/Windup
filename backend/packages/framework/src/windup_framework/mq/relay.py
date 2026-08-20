"""补投 publish_status=pending 的消息。"""

from __future__ import annotations

import logging

from windup_framework.db.session import SessionLocal
from windup_framework.mq import repository as mq_repo
from windup_framework.mq.publisher import MqPublisher

logger = logging.getLogger("windup.mq.relay")


def relay_pending_messages(*, limit: int = 100) -> int:
    """扫描 pending 行并尝试 XADD。返回成功补投条数。"""
    publisher = MqPublisher()
    session = SessionLocal()
    relayed = 0
    try:
        pending = mq_repo.list_pending(session, limit=limit)
        message_ids = [row.id for row in pending]
    finally:
        session.close()

    for message_id in message_ids:
        if publisher.flush_to_stream(message_id):
            relayed += 1
    if relayed:
        logger.info("relay 补投完成 | count=%d", relayed)
    return relayed
