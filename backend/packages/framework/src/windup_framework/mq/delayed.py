"""基于 Redis ZSET 的延迟队列,到期后投进现有 Redis Stream。

不用 keyspace notification / pubsub 过期事件:删除时机不确定、消息不持久、
多实例会广播重复消费。对齐 Redisson DelayedQueue 的做法 —— Sorted Set 的
score 是到期时间,扫描到期项再入就绪队列。就绪队列就是本仓已有的 Stream
(消费者组 + ACK),不另起一套。

参考: https://javaguide.cn/database/redis/redis-delayed-task.html
      https://javaguide.cn/database/redis/redis-stream-mq.html
"""

from __future__ import annotations

import json
import logging
import time
import uuid
from typing import Any

from windup_framework.db.redis import get_redis
from windup_framework.mq.config import DELAYED_CLAIM_LIMIT, DELAYED_ZSET_KEY

logger = logging.getLogger("windup.mq.delayed")

_PAYLOAD_HASH = f"{DELAYED_ZSET_KEY}:payload"

# 原子:按 score 取出到期 id,从 ZSET/HASH 删掉,返回 payload。避免两个 worker 同时
# 扫到同一条再投两次。
_CLAIM_LUA = """
local zkey = KEYS[1]
local hkey = KEYS[2]
local now = ARGV[1]
local limit = tonumber(ARGV[2])
local ids = redis.call('ZRANGEBYSCORE', zkey, '-inf', now, 'LIMIT', 0, limit)
if #ids == 0 then
  return {}
end
redis.call('ZREM', zkey, unpack(ids))
local out = {}
for _, id in ipairs(ids) do
  local payload = redis.call('HGET', hkey, id)
  redis.call('HDEL', hkey, id)
  if payload then
    out[#out + 1] = payload
  end
end
return out
"""


def schedule_delayed(
    *,
    delay_s: float,
    stream: str,
    msg_type: str,
    payload: dict[str, Any],
    dedupe_key: str,
) -> str:
    """把一条就绪消息排到 ``now + delay_s`` 再 XADD 到 ``stream``。"""
    if delay_s < 0:
        delay_s = 0
    item_id = str(uuid.uuid4())
    due = time.time() + delay_s
    body = json.dumps(
        {
            "id": item_id,
            "stream": stream,
            "msg_type": msg_type,
            "payload": payload,
            "dedupe_key": dedupe_key,
        },
        ensure_ascii=False,
    )
    redis_client = get_redis()
    pipe = redis_client.pipeline()
    pipe.zadd(DELAYED_ZSET_KEY, {item_id: due})
    pipe.hset(_PAYLOAD_HASH, item_id, body)
    pipe.execute()
    logger.debug(
        "延迟入队 | id=%s delay_s=%.2f type=%s dedupe=%s",
        item_id,
        delay_s,
        msg_type,
        dedupe_key,
    )
    return item_id


def claim_due(*, now: float | None = None, limit: int = DELAYED_CLAIM_LIMIT) -> list[dict[str, Any]]:
    """取出并删除已到期项。返回反序列化后的就绪信封。"""
    redis_client = get_redis()
    raw = redis_client.eval(
        _CLAIM_LUA,
        2,
        DELAYED_ZSET_KEY,
        _PAYLOAD_HASH,
        str(now if now is not None else time.time()),
        str(max(1, limit)),
    )
    items: list[dict[str, Any]] = []
    for blob in raw or []:
        if isinstance(blob, bytes):
            blob = blob.decode()
        items.append(json.loads(blob))
    return items


def promote_due_messages(*, now: float | None = None, limit: int = DELAYED_CLAIM_LIMIT) -> int:
    """把到期项写入 outbox 并 XADD。返回成功促进条数。

    ``publish_now`` 落库即受理;XADD 失败由既有 relay 补投,这里不把同一条
    再塞回 ZSET,避免与 outbox 双投。
    """
    from windup_framework.db.session import SessionLocal
    from windup_framework.mq.publisher import MqPublisher

    due = claim_due(now=now, limit=limit)
    if not due:
        return 0
    publisher = MqPublisher()
    promoted = 0
    for item in due:
        session = SessionLocal()
        try:
            publisher.publish_now(
                session,
                stream=str(item["stream"]),
                msg_type=str(item["msg_type"]),
                payload=dict(item.get("payload") or {}),
                dedupe_key=str(item["dedupe_key"]),
            )
            promoted += 1
        except Exception:
            logger.exception("延迟项促进失败,5s 后重试 | dedupe=%s", item.get("dedupe_key"))
            try:
                schedule_delayed(
                    delay_s=5,
                    stream=str(item["stream"]),
                    msg_type=str(item["msg_type"]),
                    payload=dict(item.get("payload") or {}),
                    dedupe_key=str(item["dedupe_key"]),
                )
            except Exception:
                logger.exception("延迟项重新入队失败 | dedupe=%s", item.get("dedupe_key"))
        finally:
            session.close()
    if promoted:
        logger.info("延迟队列促进 %d 条到 Stream", promoted)
    return promoted
