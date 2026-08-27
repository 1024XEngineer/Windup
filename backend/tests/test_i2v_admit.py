"""全站 i2v 在途名额与 429 冷却。"""

from __future__ import annotations

import time

import pytest

from windup_app.server.mq import i2v_admit as admit
from windup_common.enums.model import ModelErrorType
from windup_framework.gateway.context import bind_call_context
from windup_framework.gateway.errors import RateLimitBackoff
from windup_framework.gateway.types import AdapterResult

from test_gateway_video import FakeVideoAdapter, _video_gw


class _MemRedis:
    def __init__(self) -> None:
        self.sets: dict[str, set[str]] = {}
        self.kv: dict[str, tuple[str, float | None]] = {}
        self.hashes: dict[str, dict[str, str]] = {}
        self.now = time.monotonic()

    def _alive(self, key: str) -> bool:
        item = self.kv.get(key)
        if item is None:
            return False
        _value, exp = item
        if exp is not None and exp <= self.now:
            del self.kv[key]
            return False
        return True

    def sadd(self, key, member):
        self.sets.setdefault(key, set()).add(str(member))
        return 1

    def srem(self, key, member):
        bucket = self.sets.get(key)
        if not bucket:
            return 0
        bucket.discard(str(member))
        return 1

    def sismember(self, key, member):
        return 1 if str(member) in self.sets.get(key, set()) else 0

    def scard(self, key):
        return len(self.sets.get(key, set()))

    def exists(self, key):
        if key in self.sets and self.sets[key]:
            return 1
        if key in self.hashes:
            return 1
        return 1 if self._alive(key) else 0

    def delete(self, *keys):
        n = 0
        for key in keys:
            if key in self.sets:
                del self.sets[key]
                n += 1
            if key in self.hashes:
                del self.hashes[key]
                n += 1
            if key in self.kv:
                del self.kv[key]
                n += 1
        return n

    def set(self, key, value, nx=False, ex=None):
        if nx and self._alive(key):
            return None
        exp = self.now + int(ex) if ex is not None else None
        self.kv[key] = (str(value), exp)
        return True

    def ttl(self, key):
        item = self.kv.get(key)
        if item is None:
            return -2
        _value, exp = item
        if exp is None:
            return -1
        left = int(exp - self.now)
        if left < 0:
            del self.kv[key]
            return -2
        return left

    def hset(self, key, mapping=None, **_kw):
        bucket = self.hashes.setdefault(key, {})
        bucket.update({str(k): str(v) for k, v in (mapping or {}).items()})
        return len(mapping or {})

    def hgetall(self, key):
        return dict(self.hashes.get(key) or {})

    def hincrby(self, key, field, amount):
        bucket = self.hashes.setdefault(key, {})
        nxt = int(bucket.get(field) or 0) + int(amount)
        bucket[str(field)] = str(nxt)
        return nxt

    def expire(self, key, seconds):
        if key in self.hashes or self._alive(key) or key in self.sets:
            if key in self.kv:
                value, _exp = self.kv[key]
                self.kv[key] = (value, self.now + int(seconds))
            return 1
        return 0

    def scan_iter(self, match=None):
        prefix = (match or "*").rstrip("*")
        yield from [k for k in list(self.hashes) if k.startswith(prefix)]

    def eval(self, script, nkeys, *args):
        keys = args[:nkeys]
        argv = args[nkeys:]
        if "SISMEMBER" in script and "SCARD" in script:
            setkey, member, max_n = keys[0], str(argv[0]), int(argv[1])
            if self.sismember(setkey, member):
                return 1
            if self.scard(setkey) >= max_n:
                return 0
            self.sadd(setkey, member)
            return 1
        cooling, cooldown, shot = keys
        member = str(argv[0])
        if not self.exists(cooling):
            return 1
        if self.ttl(cooldown) > 0:
            return 0
        return 1 if self.set(shot, member, nx=True, ex=120) else 0


def _patch_redis(monkeypatch, mem: _MemRedis | None = None) -> _MemRedis:
    mem = mem or _MemRedis()
    monkeypatch.setattr("windup_app.server.mq.i2v_admit.get_redis", lambda: mem)
    return mem


def test_third_acquire_is_rejected(monkeypatch):
    _patch_redis(monkeypatch)
    assert admit.try_acquire(1)
    assert admit.try_acquire(2)
    assert not admit.try_acquire(3)
    assert admit.try_acquire(1)
    admit.release(1)
    assert admit.try_acquire(3)


def test_submit_allows_two_until_429_then_one_shot(monkeypatch):
    mem = _patch_redis(monkeypatch)
    assert admit.can_submit(1)
    assert admit.can_submit(2)
    wait = admit.on_rate_limit(wait_s=8, fallback_key=False, task_id=1)
    assert wait == 8
    assert not admit.can_submit(1)
    assert not admit.can_submit(2)
    mem.now += 9
    assert admit.can_submit(1)
    assert not admit.can_submit(2)
    admit.clear_cooling()
    assert admit.can_submit(2)


def test_fallback_key_advances_route_skip(monkeypatch):
    _patch_redis(monkeypatch)
    admit.on_rate_limit(wait_s=16, fallback_key=True, task_id=4)
    skip, retry = admit.retry_state(4)
    assert skip == 1
    assert retry == 0


def test_rebuild_restores_job_holders(monkeypatch):
    mem = _patch_redis(monkeypatch)
    mem.hashes["windup:i2v:11"] = {"job_id": "j1"}
    monkeypatch.setattr(
        "windup_app.server.mq.i2v_admit.load_i2v_state",
        lambda task_id: {"job_id": "j1"} if task_id == 11 else None,
    )
    admit.rebuild()
    assert admit.has_claim(11)


def test_start_i2v_429_raises_without_second_shot():
    rate = AdapterResult(ok=False, error_type=ModelErrorType.RATE_LIMIT, http_status=429)
    ad = FakeVideoAdapter(
        submits={
            "kling-v2-5-turbo": [rate, rate],
            "kling-v2-6": [AdapterResult(ok=True, job_id="wrong", maybe_billed=True)],
        },
        follows={},
    )
    with pytest.raises(RateLimitBackoff) as caught:
        _video_gw(ad).start_i2v(b"frame", "walk")
    assert caught.value.fallback_key is False
    assert caught.value.wait_s == 8
    assert ad.submit_models == ["kling-v2-5-turbo"]


def test_start_i2v_second_429_asks_for_key_switch():
    rate = AdapterResult(ok=False, error_type=ModelErrorType.RATE_LIMIT, http_status=429)
    key_a = FakeVideoAdapter(
        submits={"kling-v2-5-turbo": [rate], "kling-v2-6": []},
        follows={},
    )
    key_b = FakeVideoAdapter(
        submits={"kling-v2-5-turbo": [rate], "kling-v2-6": []},
        follows={},
    )
    from windup_framework.config.provider import AIProviderSettings
    from windup_framework.gateway.circuit import CircuitBreaker
    from windup_framework.gateway.registry import ModelRegistry
    from windup_framework.gateway.video import VideoGateway

    cfg = AIProviderSettings(
        video_model="kling-v2-5-turbo",
        video_fallbacks="kling-v2-6",
        route_primary_name="primary",
        route_primary_base_url="https://api.qnaigc.com/v1",
        route_primary_api_key="key-a",
        route_primary_api_keys="key-b",
    )
    gw = VideoGateway(
        registry=ModelRegistry.from_settings(cfg),
        adapter=key_a,
        circuit=CircuitBreaker(cooldown_s=60),
        settings=cfg,
        route_adapters={"primary.key0": key_a, "primary.key1": key_b},
    )
    reset = bind_call_context(i2v_retry_count=1)
    try:
        with pytest.raises(RateLimitBackoff) as caught:
            gw.start_i2v(b"frame", "walk")
    finally:
        reset()
    assert caught.value.fallback_key is True
    assert caught.value.wait_s == 16
    assert key_a.submit_models == ["kling-v2-5-turbo"]
    assert key_b.submit_models == []
