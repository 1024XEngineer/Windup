"""动作任务在等 i2v 成片时的 Redis 状态。

任务行保持 RUNNING;轮询间隔走 ZSET 延迟队列,不占 action worker。
"""

from __future__ import annotations

import time
from typing import Any

from windup_framework.db.redis import get_redis

I2V_KEY_PREFIX = "windup:i2v:"
I2V_STATE_TTL_S = 2 * 3600
I2V_FIRST_POLL_S = 5.0
I2V_POLL_INTERVAL_S = 60.0
I2V_MAX_WAIT_S = 30 * 60


def _key(task_id: int) -> str:
    return f"{I2V_KEY_PREFIX}{task_id}"


def save_i2v_state(
    task_id: int,
    *,
    job_id: str,
    poll_count: int,
    next_wait: float,
    started_at: float | None = None,
    route_id: str = "",
    model: str = "",
) -> None:
    redis_client = get_redis()
    mapping = {
        "job_id": job_id,
        "poll_count": str(poll_count),
        "next_wait": str(next_wait),
        "started_at": str(started_at if started_at is not None else time.time()),
        "route_id": route_id,
        "model": model,
    }
    redis_client.hset(_key(task_id), mapping=mapping)
    redis_client.expire(_key(task_id), I2V_STATE_TTL_S)


def load_i2v_state(task_id: int) -> dict[str, Any] | None:
    raw = get_redis().hgetall(_key(task_id))
    if not raw:
        return None
    return {
        "job_id": str(raw.get("job_id") or ""),
        "poll_count": int(raw.get("poll_count") or 0),
        "next_wait": float(raw.get("next_wait") or I2V_FIRST_POLL_S),
        "started_at": float(raw.get("started_at") or 0),
        "route_id": str(raw.get("route_id") or ""),
        "model": str(raw.get("model") or ""),
    }


def delete_i2v_state(task_id: int) -> None:
    get_redis().delete(_key(task_id))


def has_i2v_state(task_id: int) -> bool:
    return bool(get_redis().exists(_key(task_id)))
