from __future__ import annotations

from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
import math

from windup_common.enums.model import ModelErrorType

_MAX_RETRY_WAIT = 30.0


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def retry_after_seconds(value: str) -> float | None:
    try:
        delay = float(value)
    except ValueError:
        try:
            retry_at = parsedate_to_datetime(value)
        except (TypeError, ValueError, OverflowError):
            return None
        if retry_at.tzinfo is None:
            retry_at = retry_at.replace(tzinfo=timezone.utc)
        delay = (retry_at.astimezone(timezone.utc) - _utc_now()).total_seconds()
    if not math.isfinite(delay):
        return None
    return min(max(delay, 0.0), _MAX_RETRY_WAIT)


def classify_http(status: int) -> ModelErrorType:
    if status == 429:
        return ModelErrorType.RATE_LIMIT
    if status in (401, 403):
        return ModelErrorType.AUTH
    if status in (521, 522, 523, 525):
        return ModelErrorType.UNREACHED
    if status in (400, 404):
        return ModelErrorType.UNKNOWN
    if status >= 500:
        return ModelErrorType.MAYBE_BILLED
    return ModelErrorType.UNKNOWN
