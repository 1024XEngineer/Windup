from __future__ import annotations

from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
import math

import httpx

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
    if status in (502, 503):
        return ModelErrorType.UNREACHED
    if status in (521, 522, 523, 525):
        return ModelErrorType.UNREACHED
    if status in (400, 404):
        return ModelErrorType.UNKNOWN
    if status >= 500:
        return ModelErrorType.MAYBE_BILLED
    return ModelErrorType.UNKNOWN


def classify_exception(exc: BaseException) -> tuple[ModelErrorType, int | None, str]:
    """把没有 HTTP 状态行的传输失败收成策略输入。

    对端拆连接、连不上、写出失败:都还没拿到响应,按 UNREACHED(可同路重试)。
    读超时另算 TIMEOUT:请求可能已经离开本机,不能当成 52x。
    """
    status = getattr(exc, "status_code", None)
    response = getattr(exc, "response", None)
    if status is None and response is not None:
        status = getattr(response, "status_code", None)
    if isinstance(status, int):
        return classify_http(status), status, str(exc)[:200]
    if isinstance(
        exc,
        (
            httpx.RemoteProtocolError,
            httpx.LocalProtocolError,
            httpx.ConnectError,
            httpx.WriteError,
            httpx.NetworkError,
        ),
    ):
        return ModelErrorType.UNREACHED, None, str(exc)[:200]
    if isinstance(exc, (httpx.ReadTimeout, httpx.TimeoutException, TimeoutError)):
        return ModelErrorType.TIMEOUT, None, str(exc)[:200]
    return ModelErrorType.UNKNOWN, None, str(exc)[:200]
