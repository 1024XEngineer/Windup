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

def _video_gw(adapter) -> VideoGateway:
    cfg = AIProviderSettings(video_model="kling-v2-5-turbo", video_fallbacks="kling-v2-6")
    return VideoGateway(
        registry=ModelRegistry.from_settings(cfg),
        adapter=adapter,
        circuit=CircuitBreaker(cooldown_s=60),
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
