from __future__ import annotations

from windup_common.enums.model import ModelErrorType
from windup_framework.gateway.types import NextStep

RATE_LIMIT_BACKOFF_BASE_S = 8.0
RATE_LIMIT_SLEEP_CAP_S = 60.0


def rate_limit_wait_s(*, retry_count: int, retry_after_s: float | None) -> float:
    """429 等待：同 key 再试 8s，换 key 16s。Retry-After 作下限，封顶 60s。"""
    wait = RATE_LIMIT_BACKOFF_BASE_S * (2 ** retry_count)
    if retry_after_s is not None:
        wait = max(wait, retry_after_s)
    return min(wait, RATE_LIMIT_SLEEP_CAP_S)


def decide(
    *,
    error_type: ModelErrorType,
    retry_count: int,
    has_job_id: bool,
) -> NextStep:
    if error_type in (ModelErrorType.MAYBE_BILLED, ModelErrorType.AUTH):
        return NextStep.FAIL
    if error_type is ModelErrorType.CONFIG_ERROR:
        return NextStep.FAIL
    if error_type is ModelErrorType.JOB_NOT_FOUND:
        return NextStep.FAIL
    if error_type is ModelErrorType.MODEL_NOT_FOUND:
        return NextStep.FALLBACK
    if has_job_id and error_type is ModelErrorType.TIMEOUT:
        return NextStep.FAIL
    if has_job_id and error_type is ModelErrorType.UPSTREAM_FAILED:
        return NextStep.FALLBACK
    if error_type is ModelErrorType.UNREACHED and retry_count == 0:
        return NextStep.RETRY_SAME
    if error_type is ModelErrorType.UNREACHED and has_job_id:
        return NextStep.FAIL
    if error_type is ModelErrorType.UNREACHED:
        return NextStep.OPEN_AGGREGATOR
    if error_type is ModelErrorType.RATE_LIMIT and retry_count == 0:
        return NextStep.RETRY_SAME
    if error_type is ModelErrorType.RATE_LIMIT:
        return NextStep.FALLBACK_KEY
    if error_type is ModelErrorType.INVALID_RESPONSE and retry_count < 2:
        return NextStep.RETRY_SAME
    if error_type is ModelErrorType.INVALID_RESPONSE:
        return NextStep.FALLBACK
    return NextStep.FAIL
