"""全站 i2v 建单闸：按 API key 分车道，每把 key 独立在途名额与 429 冷却。"""

from __future__ import annotations

import os

from windup_app.server.mq.catalog import MSG_TYPE_CHARACTER_ACTION, stream_for_msg_type
from windup_app.server.mq.i2v_state import I2V_KEY_PREFIX, load_i2v_state
from windup_framework.db.redis import get_redis
from windup_framework.mq.delayed import schedule_delayed

# 全站「已占名额」索引，不算容量。容量在每条车道的 SET 上。
INFLIGHT_KEY = "windup:i2v:gate:inflight"
LANE_INFLIGHT_PREFIX = "windup:i2v:gate:inflight:"
LANE_COOLING_PREFIX = "windup:i2v:gate:cooling:"
LANE_COOLDOWN_PREFIX = "windup:i2v:gate:cooldown:"
LANE_SHOT_PREFIX = "windup:i2v:gate:shot:"
TASK_HASH_PREFIX = "windup:i2v:gate:task:"

ADMIT_RETRY_S = 5.0
_FALLBACK_RETRY_S = 1.0
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


def lane_ids() -> tuple[str, ...]:
    """当前视频路由上的 key 车道。测试可替换。"""
    from windup_framework.config.provider import settings as ai_settings
    from windup_framework.gateway.routes import routes_from_settings
    from windup_framework.gateway.types import Scene

    routes = routes_from_settings(
        ai_settings, route_group=Scene.CHARACTER_ACTION.value
    )
    ids = tuple(route.route_id for route in routes)
    return ids or ("primary.key0",)


def _task_member(task_id: int) -> str:
    return str(task_id)


def _task_hash(task_id: int) -> str:
    return f"{TASK_HASH_PREFIX}{task_id}"


def _lane_inflight(lane: str) -> str:
    return f"{LANE_INFLIGHT_PREFIX}{lane}"


def _lane_cooling(lane: str) -> str:
    return f"{LANE_COOLING_PREFIX}{lane}"


def _lane_cooldown(lane: str) -> str:
    return f"{LANE_COOLDOWN_PREFIX}{lane}"


def _lane_shot(lane: str) -> str:
    return f"{LANE_SHOT_PREFIX}{lane}"


def _bound_lane(task_id: int) -> str | None:
    raw = get_redis().hgetall(_task_hash(task_id))
    lane = str((raw or {}).get("route_id") or "")
    return lane or None


def _lane_index(lane: str) -> int:
    lanes = lane_ids()
    try:
        return lanes.index(lane)
    except ValueError:
        return 0


def _lane_cooling_wait_s(lane: str) -> float:
    ttl = get_redis().ttl(_lane_cooldown(lane))
    if ttl is None or int(ttl) < 0:
        return 0.0
    return float(ttl)


def _lane_is_hot(lane: str) -> bool:
    """冷却倒计时还没走完，新任务不该再挤这条车道。"""
    return _lane_cooling_wait_s(lane) > 0


def _bind(task_id: int, lane: str) -> None:
    redis_client = get_redis()
    key = _task_hash(task_id)
    redis_client.hset(
        key,
        mapping={
            "route_id": lane,
            "route_skip": str(_lane_index(lane)),
        },
    )
    redis_client.expire(key, _TASK_HASH_TTL_S)
    redis_client.sadd(INFLIGHT_KEY, _task_member(task_id))


def _unbind_lane(task_id: int, lane: str | None) -> None:
    if not lane:
        return
    get_redis().srem(_lane_inflight(lane), _task_member(task_id))


def _acquire_lane(lane: str, task_id: int) -> bool:
    got = get_redis().eval(
        _ACQUIRE_LUA,
        1,
        _lane_inflight(lane),
        _task_member(task_id),
        inflight_max(),
    )
    return int(got or 0) == 1


def _lanes_by_load() -> list[str]:
    redis_client = get_redis()
    scored = [
        (int(redis_client.scard(_lane_inflight(lane)) or 0), index, lane)
        for index, lane in enumerate(lane_ids())
    ]
    scored.sort()
    return [lane for _load, _index, lane in scored]


def try_acquire(task_id: int) -> bool:
    """占一条 key 车道的在途坑。已占过则成功（延迟再入队幂等）。"""
    bound = _bound_lane(task_id)
    if bound and get_redis().sismember(_lane_inflight(bound), _task_member(task_id)):
        return True
    for lane in _lanes_by_load():
        if _lane_is_hot(lane):
            continue
        if _acquire_lane(lane, task_id):
            _bind(task_id, lane)
            return True
    return False


def release(task_id: int) -> None:
    redis_client = get_redis()
    member = _task_member(task_id)
    redis_client.srem(INFLIGHT_KEY, member)
    for lane in lane_ids():
        redis_client.srem(_lane_inflight(lane), member)
    bound = _bound_lane(task_id)
    if bound:
        redis_client.srem(_lane_inflight(bound), member)
    redis_client.delete(_task_hash(task_id))


def has_claim(task_id: int) -> bool:
    return bool(get_redis().sismember(INFLIGHT_KEY, _task_member(task_id)))


def can_submit(task_id: int) -> bool:
    """该任务所在车道健康时可并行；冷却期内等到点且只能一枪。"""
    lane = _bound_lane(task_id) or lane_ids()[0]
    got = get_redis().eval(
        _SUBMIT_LUA,
        3,
        _lane_cooling(lane),
        _lane_cooldown(lane),
        _lane_shot(lane),
        _task_member(task_id),
    )
    return int(got or 0) == 1


def cooldown_remaining_s(task_id: int | None = None) -> float:
    if task_id is not None:
        lane = _bound_lane(task_id)
        if lane:
            return _lane_cooling_wait_s(lane)
    waits = [_lane_cooling_wait_s(lane) for lane in lane_ids()]
    return min(waits) if waits else 0.0


def on_rate_limit(*, wait_s: float, fallback_key: bool, task_id: int) -> float:
    """只冷却当前这条 key。换 key 时立刻改挂空闲车道，不必连坐其它 key。"""
    wait = max(1.0, float(wait_s))
    redis_client = get_redis()
    lane = _bound_lane(task_id) or lane_ids()[0]
    redis_client.set(_lane_cooling(lane), "1")
    redis_client.set(_lane_cooldown(lane), "1", ex=int(wait))
    redis_client.delete(_lane_shot(lane))
    if fallback_key:
        _unbind_lane(task_id, lane)
        skip, _retry = retry_state(task_id)
        redis_client.hset(
            _task_hash(task_id),
            mapping={"route_skip": str(skip + 1), "retry_count": "0", "route_id": ""},
        )
        redis_client.expire(_task_hash(task_id), _TASK_HASH_TTL_S)
        if try_acquire(task_id):
            return _FALLBACK_RETRY_S
        return wait
    mark_same_key_retry(task_id)
    return wait


def clear_cooling(task_id: int | None = None) -> None:
    redis_client = get_redis()
    lanes = []
    if task_id is not None:
        bound = _bound_lane(task_id)
        if bound:
            lanes = [bound]
    if not lanes:
        lanes = list(lane_ids())
    for lane in lanes:
        redis_client.delete(
            _lane_cooling(lane), _lane_cooldown(lane), _lane_shot(lane)
        )


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
    fallback = lane_ids()[0]
    for key in redis_client.scan_iter(match=f"{I2V_KEY_PREFIX}*"):
        name = key.decode() if isinstance(key, bytes) else str(key)
        suffix = name[len(I2V_KEY_PREFIX) :]
        if not suffix.isdigit():
            continue
        state = load_i2v_state(int(suffix))
        if not state or not state.get("job_id"):
            continue
        task_id = int(suffix)
        lane = str(state.get("route_id") or "") or fallback
        redis_client.sadd(INFLIGHT_KEY, suffix)
        redis_client.sadd(_lane_inflight(lane), suffix)
        _bind(task_id, lane)
