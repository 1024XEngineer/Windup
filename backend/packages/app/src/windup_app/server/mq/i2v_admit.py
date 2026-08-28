"""全站 i2v 建单闸：按 credential 分车道，每把 key 独立在途名额与 429 冷却。"""

from __future__ import annotations

import os

from windup_app.server.mq.catalog import MSG_TYPE_CHARACTER_ACTION, stream_for_msg_type
from windup_app.server.mq.i2v_state import I2V_KEY_PREFIX, load_i2v_state
from windup_framework.db.redis import get_redis
from windup_framework.gateway.pool_registry import (
    RoutableEdge,
    get_pool_snapshot,
    legacy_route_id_map,
)
from windup_framework.gateway.types import Scene
from windup_framework.mq.delayed import schedule_delayed

INFLIGHT_KEY = "windup:i2v:gate:inflight"
# #842 遗留：windup:i2v:gate:inflight:{primary.key0}
LEGACY_LANE_INFLIGHT_PREFIX = "windup:i2v:gate:inflight:"
LEGACY_LANE_COOLING_PREFIX = "windup:i2v:gate:cooling:"
LEGACY_LANE_COOLDOWN_PREFIX = "windup:i2v:gate:cooldown:"
LEGACY_LANE_SHOT_PREFIX = "windup:i2v:gate:shot:"
TASK_HASH_PREFIX = "windup:i2v:gate:task:"

ADMIT_RETRY_S = 5.0
_FALLBACK_RETRY_S = 1.0
_TASK_HASH_TTL_S = 2 * 3600
_ROUTE_GROUP = Scene.CHARACTER_ACTION.value

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


def _action_edges() -> tuple[RoutableEdge, ...]:
    return get_pool_snapshot(_ROUTE_GROUP).edges_for(_ROUTE_GROUP)


def lane_ids() -> tuple[str, ...]:
    """当前视频池 credential_id 列表。测试可 monkeypatch ``_action_edges``。"""
    ids = tuple(edge.credential_id for edge in _action_edges())
    return ids or ("primary:0000000000000000",)


def _task_member(task_id: int) -> str:
    return str(task_id)


def _task_hash(task_id: int) -> str:
    return f"{TASK_HASH_PREFIX}{task_id}"


def _edge_for_credential(cred: str) -> RoutableEdge | None:
    resolved = _normalize_route_id(cred)
    for edge in _action_edges():
        if edge.credential_id == resolved:
            return edge
    return None


def _legacy_inflight(lane: str) -> str:
    return f"{LEGACY_LANE_INFLIGHT_PREFIX}{lane}"


def _legacy_cooling(lane: str) -> str:
    return f"{LEGACY_LANE_COOLING_PREFIX}{lane}"


def _legacy_cooldown(lane: str) -> str:
    return f"{LEGACY_LANE_COOLDOWN_PREFIX}{lane}"


def _legacy_shot(lane: str) -> str:
    return f"{LEGACY_LANE_SHOT_PREFIX}{lane}"


def _normalize_route_id(route_id: str) -> str:
    if not route_id:
        return route_id
    for edge in _action_edges():
        if edge.credential_id == route_id:
            return route_id
    from windup_framework.config.provider import settings as ai_settings

    return legacy_route_id_map(ai_settings, route_group=_ROUTE_GROUP).get(route_id, route_id)


def _migrate_legacy_inflight(task_id: int, raw_lane: str, cred: str) -> None:
    """#842 车道键迁到 ``inflight:cred:{credential_id}``。"""
    if raw_lane == cred:
        return
    redis_client = get_redis()
    member = _task_member(task_id)
    old_key = _legacy_inflight(raw_lane)
    new_key = f"windup:i2v:gate:inflight:cred:{cred}"
    if redis_client.sismember(old_key, member):
        redis_client.sadd(new_key, member)
        redis_client.srem(old_key, member)


def _bound_lane(task_id: int) -> str | None:
    raw = get_redis().hgetall(_task_hash(task_id))
    lane = str((raw or {}).get("route_id") or "")
    return lane or None


def _bound_credential(task_id: int) -> str | None:
    lane = _bound_lane(task_id)
    if not lane:
        return None
    return _normalize_route_id(lane)


def _lane_cooling_wait_s(edge: RoutableEdge) -> float:
    redis_client = get_redis()
    for key in (edge.redis_cooldown_key(), _legacy_cooldown(_bound_lane(0) or "")):
        if not key.endswith(":"):
            ttl = redis_client.ttl(key)
            if ttl is not None and int(ttl) >= 0:
                return float(ttl)
    return 0.0


def _lane_cooling_wait_s_for_cred(cred: str) -> float:
    edge = _edge_for_credential(cred)
    if edge is None:
        return 0.0
    ttl = get_redis().ttl(edge.redis_cooldown_key())
    if ttl is None or int(ttl) < 0:
        bound = _bound_lane(0)
        if bound and bound != cred:
            ttl = get_redis().ttl(_legacy_cooldown(bound))
            if ttl is not None and int(ttl) >= 0:
                return float(ttl)
        return 0.0
    return float(ttl)


def _lane_is_hot(edge: RoutableEdge) -> bool:
    return _lane_cooling_wait_s_for_cred(edge.credential_id) > 0


def _bind(task_id: int, edge: RoutableEdge) -> None:
    redis_client = get_redis()
    key = _task_hash(task_id)
    redis_client.hset(
        key,
        mapping={
            "route_id": edge.credential_id,
            "route_skip": str(edge.candidate_index),
        },
    )
    redis_client.expire(key, _TASK_HASH_TTL_S)
    redis_client.sadd(INFLIGHT_KEY, _task_member(task_id))


def _unbind_edge(task_id: int, cred: str | None) -> None:
    if not cred:
        return
    edge = _edge_for_credential(cred)
    if edge is not None:
        get_redis().srem(edge.redis_inflight_key(), _task_member(task_id))
    raw = _bound_lane(task_id) or cred
    if raw != cred:
        get_redis().srem(_legacy_inflight(raw), _task_member(task_id))


def _acquire_edge(edge: RoutableEdge, task_id: int) -> bool:
    got = get_redis().eval(
        _ACQUIRE_LUA,
        1,
        edge.redis_inflight_key(),
        _task_member(task_id),
        inflight_max(),
    )
    return int(got or 0) == 1


def _edges_by_load() -> list[RoutableEdge]:
    redis_client = get_redis()
    scored = [
        (
            int(redis_client.scard(edge.redis_inflight_key()) or 0),
            edge.candidate_index,
            edge,
        )
        for edge in _action_edges()
    ]
    scored.sort()
    return [edge for _load, _index, edge in scored]


def try_acquire(task_id: int) -> bool:
    """占一条 credential 车道的在途坑。已占过则成功（延迟再入队幂等）。"""
    bound_raw = _bound_lane(task_id)
    if bound_raw:
        cred = _normalize_route_id(bound_raw)
        _migrate_legacy_inflight(task_id, bound_raw, cred)
        edge = _edge_for_credential(cred)
        if edge and get_redis().sismember(edge.redis_inflight_key(), _task_member(task_id)):
            return True
    for edge in _edges_by_load():
        if _lane_is_hot(edge):
            continue
        if _acquire_edge(edge, task_id):
            _bind(task_id, edge)
            return True
    return False


def release(task_id: int) -> None:
    redis_client = get_redis()
    member = _task_member(task_id)
    redis_client.srem(INFLIGHT_KEY, member)
    bound_raw = _bound_lane(task_id)
    cred = _normalize_route_id(bound_raw) if bound_raw else None
    for edge in _action_edges():
        redis_client.srem(edge.redis_inflight_key(), member)
    if bound_raw:
        redis_client.srem(_legacy_inflight(bound_raw), member)
    if cred:
        edge = _edge_for_credential(cred)
        if edge is not None:
            redis_client.srem(edge.redis_inflight_key(), member)
    redis_client.delete(_task_hash(task_id))


def has_claim(task_id: int) -> bool:
    return bool(get_redis().sismember(INFLIGHT_KEY, _task_member(task_id)))


def can_submit(task_id: int) -> bool:
    cred = _bound_credential(task_id) or lane_ids()[0]
    edge = _edge_for_credential(cred)
    if edge is None:
        return True
    got = get_redis().eval(
        _SUBMIT_LUA,
        3,
        edge.redis_cooling_key(),
        edge.redis_cooldown_key(),
        edge.redis_shot_key(),
        _task_member(task_id),
    )
    return int(got or 0) == 1


def cooldown_remaining_s(task_id: int | None = None) -> float:
    if task_id is not None:
        cred = _bound_credential(task_id)
        if cred:
            return _lane_cooling_wait_s_for_cred(cred)
    waits = [_lane_cooling_wait_s_for_cred(cred) for cred in lane_ids()]
    return min(waits) if waits else 0.0


def on_rate_limit(*, wait_s: float, fallback_key: bool, task_id: int) -> float:
    wait = max(1.0, float(wait_s))
    redis_client = get_redis()
    cred = _bound_credential(task_id) or lane_ids()[0]
    edge = _edge_for_credential(cred)
    if edge is not None:
        redis_client.set(edge.redis_cooling_key(), "1")
        redis_client.set(edge.redis_cooldown_key(), "1", ex=int(wait))
        redis_client.delete(edge.redis_shot_key())
    bound_raw = _bound_lane(task_id)
    if bound_raw and bound_raw != cred:
        redis_client.set(_legacy_cooling(bound_raw), "1")
        redis_client.set(_legacy_cooldown(bound_raw), "1", ex=int(wait))
        redis_client.delete(_legacy_shot(bound_raw))
    if fallback_key:
        _unbind_edge(task_id, cred)
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
    edges: list[RoutableEdge] = []
    if task_id is not None:
        cred = _bound_credential(task_id)
        if cred:
            edge = _edge_for_credential(cred)
            if edge is not None:
                edges = [edge]
            bound_raw = _bound_lane(task_id)
            if bound_raw and bound_raw != cred:
                redis_client.delete(
                    _legacy_cooling(bound_raw),
                    _legacy_cooldown(bound_raw),
                    _legacy_shot(bound_raw),
                )
    if not edges:
        edges = list(_action_edges())
    for edge in edges:
        redis_client.delete(
            edge.redis_cooling_key(),
            edge.redis_cooldown_key(),
            edge.redis_shot_key(),
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
    edges = _action_edges()
    fallback = edges[0].credential_id if edges else lane_ids()[0]
    for key in redis_client.scan_iter(match=f"{I2V_KEY_PREFIX}*"):
        name = key.decode() if isinstance(key, bytes) else str(key)
        suffix = name[len(I2V_KEY_PREFIX) :]
        if not suffix.isdigit():
            continue
        state = load_i2v_state(int(suffix))
        if not state or not state.get("job_id"):
            continue
        task_id = int(suffix)
        raw_lane = str(state.get("route_id") or "") or fallback
        cred = _normalize_route_id(raw_lane)
        edge = _edge_for_credential(cred)
        lane_cred = edge.credential_id if edge else cred
        redis_client.sadd(INFLIGHT_KEY, suffix)
        inflight_key = (
            edge.redis_inflight_key()
            if edge
            else f"windup:i2v:gate:inflight:cred:{lane_cred}"
        )
        redis_client.sadd(inflight_key, suffix)
        _migrate_legacy_inflight(task_id, raw_lane, lane_cred)
        if edge is not None:
            _bind(task_id, edge)
        else:
            redis_client.hset(
                _task_hash(task_id),
                mapping={"route_id": lane_cred, "route_skip": "0"},
            )
            redis_client.expire(_task_hash(task_id), _TASK_HASH_TTL_S)
