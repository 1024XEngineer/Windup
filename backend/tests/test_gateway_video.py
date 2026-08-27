import json
import logging

import pytest
from windup_common.enums.model import ModelErrorType
from windup_framework.config.provider import AIProviderSettings
from windup_framework.gateway.circuit import CircuitBreaker
from windup_framework.gateway.registry import ModelRegistry
from windup_framework.gateway.types import AdapterResult
from windup_framework.gateway.budget import AttemptBudget
from windup_framework.gateway.video import VideoGateway

UNREACHED = AdapterResult(ok=False, error_type=ModelErrorType.UNREACHED, http_status=522)
FAILED_JOB = AdapterResult(
    ok=False, error_type=ModelErrorType.UPSTREAM_FAILED, job_id="j1", maybe_billed=True,
)
TIMEOUT = AdapterResult(ok=False, error_type=ModelErrorType.TIMEOUT, job_id="j1", maybe_billed=True)
MP4 = AdapterResult(ok=True, body=b"\x00\x00\x00\x18ftypmp42", maybe_billed=True)

class FakeVideoAdapter:
    def __init__(self, submits: dict[str, list[AdapterResult]], follows: dict[str, AdapterResult]):
        self.submits = {k: list(v) for k, v in submits.items()}
        self.follows = dict(follows)
        self.submit_models: list[str] = []
        self.followed: list[str] = []

    def submit_video(self, first_frame, prompt, seconds, size, model):
        self.submit_models.append(model)
        return self.submits[model].pop(0)

    def follow_job(self, job_id, model=None):
        self.followed.append(job_id)
        return self.follows[job_id]

def _video_gw(adapter, circuit=None) -> VideoGateway:
    cfg = AIProviderSettings(video_model="kling-v2-5-turbo", video_fallbacks="kling-v2-6")
    return VideoGateway(
        registry=ModelRegistry.from_settings(cfg),
        adapter=adapter,
        circuit=circuit or CircuitBreaker(cooldown_s=60),
        settings=cfg,
    )


def _agnes_gw(adapter, circuit=None) -> VideoGateway:
    cfg = AIProviderSettings(
        video_model="agnes-video-2.5",
        video_fallbacks="kling-v2-5-turbo,kling-v2-6",
    )
    return VideoGateway(
        registry=ModelRegistry.from_settings(cfg),
        adapter=adapter,
        circuit=circuit or CircuitBreaker(cooldown_s=60),
        settings=cfg,
    )


def test_agnes_rate_limit_falls_back_to_kling_after_retries(monkeypatch):
    """Agnes 使用独立 key，耗尽重试后不能误走 Modelink 的 key 路由。"""
    monkeypatch.setattr("windup_framework.gateway.video.time.sleep", lambda _: None)
    rate = AdapterResult(
        ok=False,
        error_type=ModelErrorType.RATE_LIMIT,
        http_status=429,
        retry_after_s=0,
    )
    adapter = FakeVideoAdapter(
        submits={
            "agnes-video-2.5": [rate, rate, rate],
            "kling-v2-5-turbo": [
                AdapterResult(ok=True, job_id="kling-job", maybe_billed=True)
            ],
            "kling-v2-6": [],
        },
        follows={"kling-job": MP4},
    )

    assert _agnes_gw(adapter).i2v(b"frame", "walk") == MP4.body
    assert adapter.submit_models == ["agnes-video-2.5"] * 3 + ["kling-v2-5-turbo"]


def test_agnes_unreached_falls_back_to_kling_after_safe_retry():
    """Agnes 请求未到上游时安全重试一次，仍失败则启用 Kling。"""
    adapter = FakeVideoAdapter(
        submits={
            "agnes-video-2.5": [UNREACHED, UNREACHED],
            "kling-v2-5-turbo": [
                AdapterResult(ok=True, job_id="kling-job", maybe_billed=True)
            ],
            "kling-v2-6": [],
        },
        follows={"kling-job": MP4},
    )

    assert _agnes_gw(adapter).i2v(b"frame", "walk") == MP4.body
    assert adapter.submit_models == [
        "agnes-video-2.5",
        "agnes-video-2.5",
        "kling-v2-5-turbo",
    ]

def test_submit_522_retries_once_does_not_open_second_job_on_fallback_model():
    ad = FakeVideoAdapter(
        submits={"kling-v2-5-turbo": [UNREACHED, UNREACHED], "kling-v2-6": [
            AdapterResult(ok=True, job_id="j-alt", maybe_billed=True)
        ]},
        follows={},
    )
    with pytest.raises(RuntimeError, match="522"):
        _video_gw(ad).i2v(b"frame", "walk")
    assert ad.submit_models == ["kling-v2-5-turbo", "kling-v2-5-turbo"]
    assert ad.followed == []


def test_submit_522_switches_base_url_route_before_model_fallback(caplog):
    caplog.set_level(logging.INFO, logger="windup.gateway")
    primary = FakeVideoAdapter(
        submits={
            "kling-v2-5-turbo": [UNREACHED, UNREACHED],
            "kling-v2-6": [AdapterResult(ok=True, job_id="wrong", maybe_billed=True)],
        },
        follows={},
    )
    backup = FakeVideoAdapter(
        submits={
            "kling-v2-5-turbo": [AdapterResult(ok=True, job_id="j-backup", maybe_billed=True)],
            "kling-v2-6": [],
        },
        follows={"j-backup": MP4},
    )
    cfg = AIProviderSettings(
        video_model="kling-v2-5-turbo",
        video_fallbacks="kling-v2-6",
        route_primary_name="primary",
        route_primary_base_url="https://api.qnaigc.com/v1",
        route_primary_api_key="primary-key",
        route_fallback_name="backup",
        route_fallback_base_url="https://backup.example.com/v1",
        route_fallback_api_key="backup-key",
    )
    gw = VideoGateway(
        registry=ModelRegistry.from_settings(cfg),
        adapter=primary,
        circuit=CircuitBreaker(cooldown_s=60),
        settings=cfg,
        route_adapters={"primary": primary, "backup": backup},
    )

    assert gw.i2v(b"frame", "walk").startswith(b"\x00\x00\x00\x18ftyp")
    assert primary.submit_models == ["kling-v2-5-turbo", "kling-v2-5-turbo"]
    assert backup.submit_models == ["kling-v2-5-turbo"]
    assert "kling-v2-6" not in primary.submit_models

    records = [json.loads(r.message) for r in caplog.records if r.name == "windup.gateway"]
    success = [r for r in records if r.get("outcome") in ("success", "fallback_success")]
    assert success, caplog.text
    line = success[-1]
    assert line["route_reason"] == "base_url_unreached"
    assert line["route_layer"] == "base_url"
    assert line["base_url_id"] == "backup"


def test_submit_429_switches_key_on_same_base_url(monkeypatch):
    monkeypatch.setattr("windup_framework.gateway.video.time.sleep", lambda _: None)
    rate = AdapterResult(ok=False, error_type=ModelErrorType.RATE_LIMIT, http_status=429)
    key_a = FakeVideoAdapter(
        submits={
            "kling-v2-5-turbo": [rate, rate, rate],
            "kling-v2-6": [AdapterResult(ok=True, job_id="wrong", maybe_billed=True)],
        },
        follows={},
    )
    key_b = FakeVideoAdapter(
        submits={
            "kling-v2-5-turbo": [AdapterResult(ok=True, job_id="j-key-b", maybe_billed=True)],
            "kling-v2-6": [],
        },
        follows={"j-key-b": MP4},
    )
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

    assert gw.i2v(b"frame", "walk").startswith(b"\x00\x00\x00\x18ftyp")
    assert key_a.submit_models == ["kling-v2-5-turbo"] * 3
    assert key_b.submit_models == ["kling-v2-5-turbo"]
    assert "kling-v2-6" not in key_a.submit_models


def test_follow_failed_opens_new_job_on_fallback():
    ad = FakeVideoAdapter(
        submits={
            "kling-v2-5-turbo": [AdapterResult(ok=True, job_id="j1", maybe_billed=True)],
            "kling-v2-6": [AdapterResult(ok=True, job_id="j2", maybe_billed=True)],
        },
        follows={"j1": FAILED_JOB, "j2": MP4},
    )
    body = _video_gw(ad).i2v(b"frame", "walk")
    assert body.startswith(b"\x00\x00\x00\x18ftyp")
    assert ad.submit_models == ["kling-v2-5-turbo", "kling-v2-6"]
    assert ad.followed == ["j1", "j2"]

def test_timeout_does_not_submit_fallback():
    ad = FakeVideoAdapter(
        submits={
            "kling-v2-5-turbo": [AdapterResult(ok=True, job_id="j1", maybe_billed=True)],
            "kling-v2-6": [AdapterResult(ok=True, job_id="j2", maybe_billed=True)],
        },
        follows={"j1": TIMEOUT},
    )
    with pytest.raises(RuntimeError, match="timeout|超时"):
        _video_gw(ad).i2v(b"frame", "walk")
    assert ad.submit_models == ["kling-v2-5-turbo"]
    assert ad.followed == ["j1"]


@pytest.mark.parametrize(
    "error_type",
    [ModelErrorType.RATE_LIMIT, ModelErrorType.INVALID_RESPONSE],
)
def test_follow_fallback_without_upstream_fail_does_not_open_second_job(error_type):
    follow_result = AdapterResult(
        ok=False,
        error_type=error_type,
        job_id="j1",
        retry_after_s=0,
        maybe_billed=True,
    )
    ad = FakeVideoAdapter(
        submits={
            "kling-v2-5-turbo": [AdapterResult(ok=True, job_id="j1", maybe_billed=True)],
            "kling-v2-6": [AdapterResult(ok=True, job_id="j2", maybe_billed=True)],
        },
        follows={"j1": follow_result},
    )
    with pytest.raises(RuntimeError, match=error_type.value):
        _video_gw(ad).i2v(b"frame", "walk")
    assert ad.submit_models == ["kling-v2-5-turbo"]
    assert ad.followed == ["j1", "j1", "j1"]


def test_success_trace_has_phase_timings(caplog):
    caplog.set_level(logging.INFO, logger="windup.gateway")
    timed = AdapterResult(
        ok=True,
        body=b"\x00\x00\x00\x18ftypmp42",
        maybe_billed=True,
        job_id="j1",
        poll_count=2,
        poll_ms=1500,
        download_ms=80,
    )
    ad = FakeVideoAdapter(
        submits={
            "kling-v2-5-turbo": [AdapterResult(ok=True, job_id="j1", maybe_billed=True)],
            "kling-v2-6": [],
        },
        follows={"j1": timed},
    )
    _video_gw(ad).i2v(b"frame", "walk")
    records = [json.loads(r.message) for r in caplog.records if r.name == "windup.gateway"]
    success = [r for r in records if r.get("outcome") == "success"]
    assert success, caplog.text
    line = success[-1]
    assert line["poll_count"] == 2
    assert line["poll_ms"] == 1500
    assert line["download_ms"] == 80
    assert line["submit_ms"] is not None


def test_skip_open_model_circuit_sets_fallback_used(caplog):
    caplog.set_level(logging.INFO, logger="windup.gateway")
    br = CircuitBreaker(cooldown_s=60)
    br.open("model:kling-v2-5-turbo")
    ad = FakeVideoAdapter(
        submits={
            "kling-v2-5-turbo": [AdapterResult(ok=True, job_id="j1", maybe_billed=True)],
            "kling-v2-6": [AdapterResult(ok=True, job_id="j2", maybe_billed=True)],
        },
        follows={"j2": MP4},
    )
    body = _video_gw(ad, circuit=br).i2v(b"frame", "walk")
    assert body.startswith(b"\x00\x00\x00\x18ftyp")
    assert ad.submit_models == ["kling-v2-6"]
    records = [json.loads(r.message) for r in caplog.records if r.name == "windup.gateway"]
    success = [r for r in records if r.get("outcome") in ("success", "fallback_success")]
    assert success, caplog.text
    line = success[-1]
    assert line["fallback_used"] is True
    assert line["outcome"] == "fallback_success"
    assert line["route_reason"] == "skip_circuit_open"


def test_submit_invalid_response_does_not_open_fallback_job():
    invalid = AdapterResult(ok=False, error_type=ModelErrorType.INVALID_RESPONSE)
    ad = FakeVideoAdapter(
        submits={
            "kling-v2-5-turbo": [invalid, invalid, invalid],
            "kling-v2-6": [AdapterResult(ok=True, job_id="j-alt", maybe_billed=True)],
        },
        follows={"j-alt": MP4},
    )
    with pytest.raises(RuntimeError, match="invalid_response"):
        _video_gw(ad).i2v(b"frame", "walk")
    assert "kling-v2-6" not in ad.submit_models
    assert ad.submit_models == ["kling-v2-5-turbo"] * 3


def test_submit_model_not_found_fallbacks_to_next_model():
    missing = AdapterResult(
        ok=False, error_type=ModelErrorType.MODEL_NOT_FOUND, http_status=404
    )
    ad = FakeVideoAdapter(
        submits={
            "kling-v2-5-turbo": [missing],
            "kling-v2-6": [AdapterResult(ok=True, job_id="j-alt", maybe_billed=True)],
        },
        follows={"j-alt": MP4},
    )
    body = _video_gw(ad).i2v(b"frame", "walk")
    assert body.startswith(b"\x00\x00\x00\x18ftyp")
    assert ad.submit_models == ["kling-v2-5-turbo", "kling-v2-6"]


def test_success_is_not_rejected_when_maybe_billed_budget_full(monkeypatch):
    monkeypatch.setattr(AttemptBudget, "max_maybe_billed", 0)
    ad = FakeVideoAdapter(
        submits={
            "kling-v2-5-turbo": [AdapterResult(ok=True, job_id="j1", maybe_billed=True)],
            "kling-v2-6": [],
        },
        follows={"j1": MP4},
    )
    body = _video_gw(ad).i2v(b"frame", "walk")
    assert body.startswith(b"\x00\x00\x00\x18ftyp")


def test_start_i2v_returns_job_without_follow():
    ad = FakeVideoAdapter(
        submits={
            "kling-v2-5-turbo": [AdapterResult(ok=True, job_id="j-start", maybe_billed=True)],
            "kling-v2-6": [],
        },
        follows={"j-start": MP4},
    )
    job = _video_gw(ad).start_i2v(b"frame", "walk")
    assert job.job_id == "j-start"
    assert job.model == "kling-v2-5-turbo"
    assert ad.followed == []


def test_poll_i2v_pending_then_download():
    class _PollAdapter(FakeVideoAdapter):
        def inspect_job(self, job_id, model=None):
            self.followed.append(f"inspect:{job_id}")
            return AdapterResult(
                ok=True,
                job_id=job_id,
                job_status="completed",
                edge_fingerprint="https://cdn.example.com/out.mp4",
            )

        def download_completed(self, job_id, url, model=None):
            self.followed.append(f"download:{model}")
            return AdapterResult(ok=True, body=b"mp4-bytes", job_id=job_id, job_status="completed")

    ad = _PollAdapter(submits={}, follows={})
    result = _video_gw(ad).poll_i2v("j-start", model="kling-v2-5-turbo")
    assert result.ok
    assert result.body == b"mp4-bytes"
    assert ad.followed == ["inspect:j-start", "download:kling-v2-5-turbo"]


def test_poll_i2v_still_pending():
    class _Pending(FakeVideoAdapter):
        def inspect_job(self, job_id, model=None):
            return AdapterResult(ok=False, job_id=job_id, maybe_billed=True, job_status="in_progress")

    result = _video_gw(_Pending(submits={}, follows={})).poll_i2v("j1")
    assert not result.ok
    assert result.error_type is None
    assert result.job_status == "in_progress"


def test_submit_ok_without_job_id_is_invalid_response():
    no_id = AdapterResult(ok=True, body=b"")
    ad = FakeVideoAdapter(
        submits={
            "kling-v2-5-turbo": [no_id, no_id, no_id],
            "kling-v2-6": [AdapterResult(ok=True, job_id="j-alt", maybe_billed=True)],
        },
        follows={"j-alt": MP4},
    )
    with pytest.raises(RuntimeError, match="invalid_response"):
        _video_gw(ad).i2v(b"frame", "walk")
    assert "kling-v2-6" not in ad.submit_models
    assert ad.submit_models == ["kling-v2-5-turbo"] * 3
