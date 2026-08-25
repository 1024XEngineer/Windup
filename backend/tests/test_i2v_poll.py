"""i2v 等待态应用服务:挂起 / 探活 / 恢复,不碰 Redis 细节以外的编排。"""

from __future__ import annotations

import time

import pytest

from windup_app.server.orchestrator.i2v_poll import (
    Ready,
    Waiting,
    inspect,
    reschedule_if_waiting,
    schedule,
)


def test_schedule_persists_state_and_enqueues_delayed_poll(monkeypatch):
    saved: dict = {}
    delayed: dict = {}

    monkeypatch.setattr(
        "windup_app.server.orchestrator.i2v_poll.save_i2v_state",
        lambda task_id, **kw: saved.update({"task_id": task_id, **kw}),
    )
    monkeypatch.setattr(
        "windup_app.server.orchestrator.i2v_poll.schedule_delayed",
        lambda **kw: delayed.update(kw),
    )

    schedule(9, {"job_id": "j1", "route_id": "primary", "model": "m"}, poll_count=0)

    assert saved["task_id"] == 9
    assert saved["job_id"] == "j1"
    assert delayed["msg_type"] == "character_action_poll"
    assert delayed["payload"]["task_id"] == 9
    assert delayed["dedupe_key"] == "generation:9:poll:0"


def test_inspect_returns_waiting_and_reschedules(monkeypatch):
    parked: list[int] = []
    monkeypatch.setattr(
        "windup_app.server.orchestrator.i2v_poll.load_i2v_state",
        lambda task_id: {
            "job_id": "j1",
            "poll_count": 0,
            "next_wait": 5.0,
            "started_at": time.time(),
            "route_id": "primary",
            "model": "m",
        },
    )
    monkeypatch.setattr(
        "windup_app.server.orchestrator.i2v_poll.schedule",
        lambda task_id, job, **kw: parked.append(task_id),
    )

    out = inspect(9, poll_video=lambda *_a, **_k: None)
    assert isinstance(out, Waiting)
    assert parked == [9]


def test_inspect_returns_ready_without_reschedule(monkeypatch):
    monkeypatch.setattr(
        "windup_app.server.orchestrator.i2v_poll.load_i2v_state",
        lambda task_id: {
            "job_id": "j1",
            "poll_count": 1,
            "next_wait": 10.0,
            "started_at": time.time(),
            "route_id": "primary",
            "model": "m",
        },
    )
    monkeypatch.setattr(
        "windup_app.server.orchestrator.i2v_poll.schedule",
        lambda *_a, **_k: (_ for _ in ()).throw(AssertionError("成片不该再挂单")),
    )

    out = inspect(9, poll_video=lambda *_a, **_k: b"mp4")
    assert isinstance(out, Ready)
    assert out.video == b"mp4"
    assert out.route_id == "primary"


def test_reschedule_if_waiting_false_without_state(monkeypatch):
    monkeypatch.setattr(
        "windup_app.server.orchestrator.i2v_poll.load_i2v_state",
        lambda task_id: None,
    )
    assert reschedule_if_waiting(9) is False


def test_reschedule_if_waiting_enqueues_soon(monkeypatch):
    delayed: dict = {}
    monkeypatch.setattr(
        "windup_app.server.orchestrator.i2v_poll.load_i2v_state",
        lambda task_id: {
            "job_id": "j1",
            "poll_count": 3,
            "next_wait": 40.0,
            "started_at": time.time(),
            "route_id": "",
            "model": "",
        },
    )
    monkeypatch.setattr(
        "windup_app.server.orchestrator.i2v_poll.schedule_delayed",
        lambda **kw: delayed.update(kw),
    )

    assert reschedule_if_waiting(9) is True
    assert delayed["delay_s"] == 1
    assert delayed["dedupe_key"] == "generation:9:poll:3"


def _expired_state() -> dict:
    return {
        "job_id": "j1",
        "poll_count": 8,
        "next_wait": 60.0,
        "started_at": time.time() - 10_000,
        "route_id": "primary",
        "model": "m",
    }


def test_inspect_last_poll_after_timeout_returns_ready(monkeypatch):
    monkeypatch.setattr(
        "windup_app.server.orchestrator.i2v_poll.load_i2v_state",
        lambda task_id: _expired_state(),
    )
    monkeypatch.setattr(
        "windup_app.server.orchestrator.i2v_poll.schedule",
        lambda *_a, **_k: (_ for _ in ()).throw(AssertionError("超时成片不该再挂单")),
    )

    out = inspect(9, poll_video=lambda *_a, **_k: b"mp4")
    assert isinstance(out, Ready)
    assert out.video == b"mp4"


def test_inspect_timeout_without_video_still_fails(monkeypatch):
    monkeypatch.setattr(
        "windup_app.server.orchestrator.i2v_poll.load_i2v_state",
        lambda task_id: _expired_state(),
    )
    with pytest.raises(RuntimeError, match="未取得视频 URL"):
        inspect(9, poll_video=lambda *_a, **_k: None)


def test_inspect_missing_state_returns_waiting_without_poll(monkeypatch):
    polled: list[int] = []
    parked: list[int] = []
    monkeypatch.setattr(
        "windup_app.server.orchestrator.i2v_poll.load_i2v_state",
        lambda task_id: None,
    )
    monkeypatch.setattr(
        "windup_app.server.orchestrator.i2v_poll.schedule",
        lambda task_id, job, **kw: parked.append(task_id),
    )

    out = inspect(9, poll_video=lambda *_a, **_k: polled.append(1) or None)
    assert isinstance(out, Waiting)
    assert polled == []
    assert parked == []
