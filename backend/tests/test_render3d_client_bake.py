"""出帧交给用户浏览器(#714):登记、收帧、收口,以及闸口一道不减。

**这条线最容易出的错不是崩溃,而是安静地交付坏产物** —— 帧少一张、朝向反了、全透明帧
冒充成功,而帧数、时长、成色在下游全都自洽。所以本文件的用例大半在验"该拒的拒了"。
"""

from __future__ import annotations

import struct
import zlib

import pytest

from windup_app.server.orchestrator import client_bake
from windup_app.server.orchestrator.client_bake import ClientBakeError, ClientBakeSpec


class _MemPipeline:
    def __init__(self, mem: "_MemRedis") -> None:
        self._mem = mem
        self._steps: list = []

    def delete(self, *keys):
        self._steps.append(lambda: self._mem.delete(*keys))
        return self

    def hset(self, name, key=None, value=None, mapping=None):
        self._steps.append(lambda: self._mem.hset(name, key, value, mapping))
        return self

    def expire(self, name, ttl):
        self._steps.append(lambda: 1)
        return self

    def hlen(self, name):
        self._steps.append(lambda: self._mem.hlen(name))
        return self

    def execute(self):
        return [step() for step in self._steps]


class _MemRedis:
    """够跑本模块用到的那几个 hash 命令;签名照 redis-py,免得桩比被测代码更宽松。"""

    def __init__(self) -> None:
        self.hashes: dict[str, dict[str, str]] = {}

    def pipeline(self):
        return _MemPipeline(self)

    def delete(self, *keys):
        for key in keys:
            self.hashes.pop(key, None)
        return len(keys)

    def hset(self, name, key=None, value=None, mapping=None):
        bucket = self.hashes.setdefault(name, {})
        if key is not None:
            bucket[str(key)] = str(value)
        if mapping:
            bucket.update({str(k): str(v) for k, v in mapping.items()})
        return 1

    def hlen(self, name):
        return len(self.hashes.get(name, {}))

    def expire(self, name, ttl):
        return 1

    def hget(self, name, key):
        return self.hashes.get(name, {}).get(str(key))

    def hgetall(self, name):
        return dict(self.hashes.get(name, {}))


def _png(width: int = 4, height: int = 4) -> bytes:
    """一张真 PNG。用真的而不是 b"\\x89PNG..." 前缀串,是因为守卫只认前缀就等于没验。"""
    raw = b"".join(b"\x00" + b"\xff\x00\x00\xff" * width for _ in range(height))

    def chunk(tag: bytes, payload: bytes) -> bytes:
        return (
            struct.pack(">I", len(payload))
            + tag
            + payload
            + struct.pack(">I", zlib.crc32(tag + payload) & 0xFFFFFFFF)
        )

    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw))
        + chunk(b"IEND", b"")
    )


SPEC = ClientBakeSpec(
    model_url="https://cdn.test/media/model-3d/rigged.glb",
    clip="walk",
    direction="e",
    camera_yaw=0.0,
    frames=3,
    width=1536,
    height=2560,
    material="cel",
    min_coverage=0.005,
)


@pytest.fixture
def redis_mem(monkeypatch):
    mem = _MemRedis()
    monkeypatch.setattr("windup_app.server.orchestrator.client_bake.get_redis", lambda: mem)
    monkeypatch.setattr(
        "windup_app.server.orchestrator.client_bake.schedule_delayed",
        lambda **kwargs: kwargs.get("dedupe_key", ""),
    )
    return mem


def test_open_job_then_load_spec_roundtrips(redis_mem):
    deadline = client_bake.open_job(7, SPEC)
    loaded, stored_deadline = client_bake.load_spec(7)
    assert loaded == SPEC
    assert stored_deadline == pytest.approx(deadline)


def test_load_spec_absent_is_none_not_error(redis_mem):
    assert client_bake.load_spec(404) is None


def test_put_frame_counts_and_collect_orders_by_index(redis_mem):
    client_bake.open_job(7, SPEC)
    for index in (2, 0, 1):
        client_bake.put_frame(7, index, _png(width=index + 1))
    frames = client_bake.collect_frames(7, 3)
    assert [len(f) for f in frames] == [
        len(_png(width=1)),
        len(_png(width=2)),
        len(_png(width=3)),
    ]


def test_collect_rejects_missing_frame(redis_mem):
    """少给一帧的后果是"步子没走完的动作",下游全部自洽 —— 只能在这里拦。"""
    client_bake.open_job(7, SPEC)
    client_bake.put_frame(7, 0, _png())
    client_bake.put_frame(7, 2, _png())
    with pytest.raises(ClientBakeError, match="缺第 1 帧"):
        client_bake.collect_frames(7, 3)


def test_put_frame_rejects_non_png(redis_mem):
    client_bake.open_job(7, SPEC)
    with pytest.raises(ClientBakeError, match="不是 PNG"):
        client_bake.put_frame(7, 0, b"data:,")


def test_put_frame_rejects_index_out_of_range(redis_mem):
    client_bake.open_job(7, SPEC)
    with pytest.raises(ClientBakeError, match="不在 0\\.\\.2"):
        client_bake.put_frame(7, 3, _png())


def test_put_frame_rejects_oversized(redis_mem):
    client_bake.open_job(7, SPEC)
    huge = _png() + b"\x00" * client_bake.MAX_FRAME_BYTES
    with pytest.raises(ClientBakeError, match="超过上限"):
        client_bake.put_frame(7, 0, huge)


def test_put_frame_without_open_job_is_refused(redis_mem):
    with pytest.raises(ClientBakeError, match="没有待出帧的登记"):
        client_bake.put_frame(7, 0, _png())


def test_open_job_clears_previous_frames(redis_mem):
    """重开同一任务必须从零收。留着上一轮的帧会让"已收 3/3"在新一轮直接成立。"""
    client_bake.open_job(7, SPEC)
    client_bake.put_frame(7, 0, _png())
    client_bake.open_job(7, SPEC)
    with pytest.raises(ClientBakeError, match="缺第 0 帧"):
        client_bake.collect_frames(7, 3)


def test_public_view_is_json_safe(redis_mem):
    client_bake.open_job(7, SPEC)
    view = client_bake.public_view(7)
    assert view["task_id"] == 7
    assert view["model_url"] == SPEC.model_url
    assert view["frames"] == 3
    assert view["received"] == 0
    assert isinstance(view["deadline_at"], float)


def test_enabled_defaults_on_and_reads_env(monkeypatch):
    monkeypatch.delenv("WINDUP_RENDER3D_CLIENT_BAKE", raising=False)
    assert client_bake.enabled() is True
    monkeypatch.setenv("WINDUP_RENDER3D_CLIENT_BAKE", "0")
    assert client_bake.enabled() is False
    monkeypatch.setenv("WINDUP_RENDER3D_CLIENT_BAKE", "off")
    assert client_bake.enabled() is False


def test_clear_removes_both_keys(redis_mem):
    client_bake.open_job(7, SPEC)
    client_bake.put_frame(7, 0, _png())
    client_bake.clear(7)
    assert client_bake.load_spec(7) is None


# ── 浏览器交回的派生资产（#774）──────────────────────────────────────────


def test_derived_roundtrips(redis_mem):
    client_bake.open_job(7, SPEC)
    client_bake.save_derived(
        7,
        rig={"bones": 28, "root_bone": "Hips", "bone_names": ["Hips", "Spine"],
             "skinned_meshes": 1, "vertices": 51388, "available_clips": {"walk": 1.07}},
        root_motion=[[0.0, 0.0], [0.1, 0.0]],
    )
    rig, motion = client_bake.load_derived(7)
    assert rig["bones"] == 28
    assert rig["bone_names"] == ["Hips", "Spine"]
    assert motion == [[0.0, 0.0], [0.1, 0.0]]


def test_derived_absent_is_none_not_error(redis_mem):
    client_bake.open_job(7, SPEC)
    assert client_bake.load_derived(7) == (None, None)


def test_saving_nothing_writes_nothing(redis_mem):
    """两样都空就别写 —— 模型没有根骨位置轨是正常情况，不是故障。"""
    client_bake.open_job(7, SPEC)
    client_bake.save_derived(7)
    assert client_bake.load_derived(7) == (None, None)


def test_corrupt_derived_reads_as_absent(redis_mem):
    """存坏了当没有，不要让一段坏 JSON 把整条交付打断。"""
    client_bake.open_job(7, SPEC)
    redis_mem.hset(client_bake._key(7), "derived", "{不是 json")
    assert client_bake.load_derived(7) == (None, None)
