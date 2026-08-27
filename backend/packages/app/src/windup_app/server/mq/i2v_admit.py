"""全站 i2v 建单闸：在途名额 + 429 冷却。限的是厂商 API key，不是单个用户。"""

from __future__ import annotations

import os
import time

from windup_app.server.mq.catalog import MSG_TYPE_CHARACTER_ACTION, stream_for_msg_type
from windup_app.server.mq.i2v_state import I2V_KEY_PREFIX, load_i2v_state
from windup_framework.db.redis import get_redis
from windup_framework.mq.delayed import schedule_delayed

INFLIGHT_KEY = "windup:i2v:gate:inflight"
COOLING_KEY = "windup:i2v:gate:cooling"
COOLDOWN_KEY = "windup:i2v:gate:cooldown"
SHOT_KEY = "windup:i2v:gate:shot"
TASK_HASH_PREFIX = "windup:i2v:gate:task:"

ADMIT_RETRY_S = 5.0
_TASK_HASH_TTL_S = 2 * 3600

_ACQUIRE_LUA = """
local setkey = KEYS[1]
local member = ARGV[1]
local max = tonumber(ARGV[2])
if redis.call('SISMEMBER', setkey, member) == 1 then
  return 1
end
if redis.call('SCARD', setkey) >= max then
  return 0
end
redis.call('SADD', setkey, member)
return 1
"""

_SUBMIT_LUA = """
local cooling = KEYS[1]
local cooldown = KEYS[2]
local shot = KEYS[3]
local member = ARGV[1]
if redis.call('EXISTS', cooling) == 0 then
  return 1
end
local ttl = redis.call('TTL', cooldown)
if ttl > 0 then
  return 0
end
local ok = redis.call('SET', shot, member, 'NX', 'EX', 120)
if ok then
  return 1
end
return 0
"""


def inflight_max() -> int:
    raw = os.getenv("WINDUP_I2V_INFLIGHT_MAX", "").strip()
    if not raw:
        return 2
    return max(1, int(raw))


def _task_member(task_id: int) -> str:
    return str(task_id)


def _task_hash(task_id: int) -> str:
    return f"{TASK_HASH_PREFIX}{task_id}"


def try_acquire(task_id: int) -> bool:
    """占一个全站在途坑。已占过则成功（延迟再入队幂等）。"""
    got = get_redis().eval(
        _ACQUIRE_LUA,
        1,
        INFLIGHT_KEY,
        _task_member(task_id),
        inflight_max(),
    )
    return int(got or 0) == 1


def release(task_id: int) -> None:
    redis_client = get_redis()
    redis_client.srem(INFLIGHT_KEY, _task_member(task_id))
    redis_client.delete(_task_hash(task_id))


def has_claim(task_id: int) -> bool:
    return bool(get_redis().sismember(INFLIGHT_KEY, _task_member(task_id)))


def can_submit(task_id: int) -> bool:
    """健康时可并行；冷却期内等到点且只能一枪。"""
    got = get_redis().eval(
        _SUBMIT_LUA,
        3,
        COOLING_KEY,
        COOLDOWN_KEY,
        SHOT_KEY,
        _task_member(task_id),
    )
    return int(got or 0) == 1


def cooldown_remaining_s() -> float:
    ttl = get_redis().ttl(COOLDOWN_KEY)
    if ttl is None or int(ttl) < 0:
        return 0.0
    return float(ttl)


def on_rate_limit(*, wait_s: float, fallback_key: bool, task_id: int) -> float:
    """记冷却，清单发锁。返回这次应延迟的秒数。"""
    wait = max(1.0, float(wait_s))
    redis_client = get_redis()
    redis_client.set(COOLING_KEY, "1")
    redis_client.set(COOLDOWN_KEY, "1", ex=int(wait))
    redis_client.delete(SHOT_KEY)
    if fallback_key:
        advance_route(task_id)
    else:
        mark_same_key_retry(task_id)
    return wait


def clear_cooling() -> None:
    redis_client = get_redis()
    redis_client.delete(COOLING_KEY, COOLDOWN_KEY, SHOT_KEY)


def retry_state(task_id: int) -> tuple[int, int]:
    raw = get_redis().hgetall(_task_hash(task_id))
    if not raw:
        return 0, 0
    skip = int(raw.get("route_skip") or 0)
    retry_count = int(raw.get("retry_count") or 0)
    return skip, retry_count


def mark_same_key_retry(task_id: int) -> None:
    redis_client = get_redis()
    key = _task_hash(task_id)
    skip, _retry = retry_state(task_id)
    redis_client.hset(key, mapping={"route_skip": str(skip), "retry_count": "1"})
    redis_client.expire(key, _TASK_HASH_TTL_S)


def advance_route(task_id: int) -> None:
    redis_client = get_redis()
    key = _task_hash(task_id)
    skip, _retry = retry_state(task_id)
    redis_client.hset(
        key,
        mapping={"route_skip": str(skip + 1), "retry_count": "0"},
    )
    redis_client.expire(key, _TASK_HASH_TTL_S)


def schedule_retry(task_id: int, delay_s: float) -> None:
    redis_client = get_redis()
    key = _task_hash(task_id)
    seq = int(redis_client.hincrby(key, "seq", 1))
    redis_client.expire(key, _TASK_HASH_TTL_S)
    wait = max(1.0, float(delay_s))
    schedule_delayed(
        delay_s=wait,
        stream=stream_for_msg_type(MSG_TYPE_CHARACTER_ACTION),
        msg_type=MSG_TYPE_CHARACTER_ACTION,
        payload={
            "task_id": task_id,
            "task_type": "character_action",
            "resume_i2v_admit": True,
        },
        dedupe_key=f"generation:{task_id}:admit:{seq}",
    )


def rebuild() -> None:
    """进程重启后按已建单的 i2v 状态把在途集合补回去。"""
    redis_client = get_redis()
    for key in redis_client.scan_iter(match=f"{I2V_KEY_PREFIX}*"):
        name = key.decode() if isinstance(key, bytes) else str(key)
        suffix = name[len(I2V_KEY_PREFIX) :]
        if not suffix.isdigit():
            continue
        state = load_i2v_state(int(suffix))
        if state and state.get("job_id"):
            redis_client.sadd(INFLIGHT_KEY, suffix)
