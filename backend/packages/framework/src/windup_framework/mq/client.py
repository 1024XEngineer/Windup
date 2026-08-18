"""Redis Stream 薄封装。"""

from __future__ import annotations

import json
import logging
from typing import Any

import redis

from windup_framework.mq.config import PEL_CLAIM_IDLE_MS, STREAM_MAXLEN

logger = logging.getLogger("windup.mq.client")


def ensure_consumer_group(
    redis_client: redis.Redis,
    stream: str,
    group: str,
) -> None:
    """创建消费者组；已存在则忽略 BUSYGROUP。"""
    try:
        redis_client.xgroup_create(stream, group, id="0", mkstream=True)
    except redis.ResponseError as exc:
        if "BUSYGROUP" not in str(exc):
            raise


def xadd_message(
    redis_client: redis.Redis,
    stream: str,
    envelope: dict[str, Any],
) -> str:
    """写入 Stream 并近似裁剪。"""
    fields = {"data": json.dumps(envelope, ensure_ascii=False)}
    stream_id = redis_client.xadd(stream, fields, maxlen=STREAM_MAXLEN, approximate=True)
    return str(stream_id)


def xreadgroup(
    redis_client: redis.Redis,
    *,
    group: str,
    consumer: str,
    streams: dict[str, str],
    count: int = 1,
    block_ms: int = 1000,
) -> list[tuple[str, list[tuple[str, dict[str, str]]]]]:
    """阻塞读取新消息。"""
    result = redis_client.xreadgroup(
        groupname=group,
        consumername=consumer,
        streams=streams,
        count=count,
        block=block_ms,
    )
    return result or []


def xack(
    redis_client: redis.Redis,
    stream: str,
    group: str,
    *message_ids: str,
) -> int:
    return int(redis_client.xack(stream, group, *message_ids))


def claim_idle_messages(
    redis_client: redis.Redis,
    stream: str,
    group: str,
    consumer: str,
    *,
    min_idle_ms: int = PEL_CLAIM_IDLE_MS,
    count: int = 10,
    start_id: str = "0-0",
) -> tuple[list[tuple[str, dict[str, str]]], str]:
    """认领 PEL 中超 idle 阈值的消息，返回下一页 start id。"""
    try:
        result = redis_client.xautoclaim(
            stream,
            group,
            consumer,
            min_idle_time=min_idle_ms,
            start_id=start_id,
            count=count,
        )
    except redis.ResponseError:
        return [], start_id
    if not result or len(result) < 2:
        return [], start_id
    next_start = str(result[0])
    messages = [(msg_id, fields) for msg_id, fields in result[1]]
    return messages, next_start


def parse_envelope(fields: dict[str, str]) -> dict[str, Any]:
    raw = fields.get("data") or fields.get(b"data")
    if raw is None:
        raise ValueError("Stream 消息缺少 data 字段")
    if isinstance(raw, bytes):
        raw = raw.decode()
    return json.loads(raw)
