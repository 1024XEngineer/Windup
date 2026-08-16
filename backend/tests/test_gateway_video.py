import json
import logging

import pytest
from windup_common.enums.model import ModelErrorType
from windup_framework.config.provider import AIProviderSettings
from windup_framework.gateway.circuit import CircuitBreaker
from windup_framework.gateway.registry import ModelRegistry
from windup_framework.gateway.types import AdapterResult
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

    def follow_job(self, job_id):
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
