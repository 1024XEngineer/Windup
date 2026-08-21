import threading
import time

from windup_common.enums.model import ModelErrorType
from windup_framework.gateway.circuit import CircuitBreaker
from windup_framework.gateway.policy import decide
from windup_framework.gateway.types import NextStep


def test_522_retries_once_then_opens_aggregator():
    assert decide(error_type=ModelErrorType.UNREACHED, retry_count=0, has_job_id=False) is NextStep.RETRY_SAME
    assert decide(error_type=ModelErrorType.UNREACHED, retry_count=1, has_job_id=False) is NextStep.OPEN_AGGREGATOR


def test_429_retries_twice_then_fallback_key():
    assert decide(error_type=ModelErrorType.RATE_LIMIT, retry_count=0, has_job_id=False) is NextStep.RETRY_SAME
    assert decide(error_type=ModelErrorType.RATE_LIMIT, retry_count=1, has_job_id=False) is NextStep.RETRY_SAME
    assert decide(error_type=ModelErrorType.RATE_LIMIT, retry_count=2, has_job_id=False) is NextStep.FALLBACK_KEY


def test_520_never_retries():
    assert decide(error_type=ModelErrorType.MAYBE_BILLED, retry_count=0, has_job_id=False) is NextStep.FAIL


def test_empty_image_retries_then_fallback():
    assert decide(error_type=ModelErrorType.INVALID_RESPONSE, retry_count=0, has_job_id=False) is NextStep.RETRY_SAME
    assert decide(error_type=ModelErrorType.INVALID_RESPONSE, retry_count=2, has_job_id=False) is NextStep.FALLBACK


def test_job_id_blocks_fallback_on_unreached():
    assert decide(error_type=ModelErrorType.UNREACHED, retry_count=0, has_job_id=True) is NextStep.RETRY_SAME
    assert decide(error_type=ModelErrorType.UNREACHED, retry_count=1, has_job_id=True) is NextStep.FAIL


def test_upstream_job_failure_fallbacks():
    assert decide(error_type=ModelErrorType.UPSTREAM_FAILED, retry_count=0, has_job_id=True) is NextStep.FALLBACK


def test_poll_timeout_fails_without_new_job():
    assert decide(error_type=ModelErrorType.TIMEOUT, retry_count=0, has_job_id=True) is NextStep.FAIL


def test_model_not_found_fallbacks():
    assert decide(error_type=ModelErrorType.MODEL_NOT_FOUND, retry_count=0, has_job_id=False) is NextStep.FALLBACK


def test_config_error_fails_fast():
    assert decide(error_type=ModelErrorType.CONFIG_ERROR, retry_count=0, has_job_id=False) is NextStep.FAIL


def test_job_not_found_fails():
    assert decide(error_type=ModelErrorType.JOB_NOT_FOUND, retry_count=0, has_job_id=True) is NextStep.FAIL


def test_circuit_opens_and_cools_down(monkeypatch):
    clock = {"t": 0.0}
    br = CircuitBreaker(cooldown_s=60, monotonic=lambda: clock["t"])
    assert not br.is_open("aggregator")
    br.open("aggregator")
    assert br.is_open("aggregator")
    clock["t"] = 59.0
    assert br.is_open("aggregator")
    clock["t"] = 60.0
    assert not br.is_open("aggregator")


def test_circuit_expiry_is_thread_safe():
    clock = {"t": 0.0}

    def now() -> float:
        time.sleep(0.002)
        return clock["t"]

    br = CircuitBreaker(cooldown_s=60, monotonic=now)
    errors: list[BaseException] = []

    def expire_once(barrier: threading.Barrier) -> None:
        try:
            barrier.wait()
            br.is_open("k")
        except BaseException as exc:
            errors.append(exc)

    clock["t"] = 0.0
    br.open("k")
    clock["t"] = 60.0
    n = 8
    barrier = threading.Barrier(n)
    threads = [threading.Thread(target=expire_once, args=(barrier,)) for _ in range(n)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert errors == []
    assert not br.is_open("k")
