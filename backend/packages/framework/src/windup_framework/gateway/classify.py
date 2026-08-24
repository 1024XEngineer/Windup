from __future__ import annotations

import json
import math
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime

import httpx
from openai import APIConnectionError, APITimeoutError

from windup_common.enums.model import ModelErrorType

_MAX_RETRY_WAIT = 30.0

_MODEL_HINTS = (
    "model_not_found",
    "model not found",
    "invalid model",
    "unknown model",
    "does not exist",
    "model_not_exist",
)
_CONFIG_HINTS = (
    "invalid url",
    "unknown url",
    "no route",
    "endpoint",
    "not found",
)


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _body_lower(body: str | None) -> str:
    if not body:
        return ""
    return body.lower()


def _json_error_code(body: str | None) -> str:
    if not body:
        return ""
    try:
        payload = json.loads(body)
    except (json.JSONDecodeError, TypeError):
        return ""
    if not isinstance(payload, dict):
        return ""
    err = payload.get("error")
    if isinstance(err, dict):
        code = err.get("code") or err.get("type")
        return str(code or "").lower()
    return str(err or "").lower()


def _looks_like_model_not_found(status: int, body: str | None) -> bool:
    if status not in (400, 404):
        return False
    text = _body_lower(body)
    code = _json_error_code(body)
    if any(h in text or h in code for h in _MODEL_HINTS):
        return True
    if status == 404 and "model" in text:
        return True
    return status == 404


def _looks_like_config_error(status: int, body: str | None) -> bool:
    if status not in (400, 404):
        return False
    text = _body_lower(body)
    code = _json_error_code(body)
    if any(h in text or h in code for h in _CONFIG_HINTS):
        if "model" in text and status in (400, 404):
            return False
        return True
    return False


def classify_http_response(
    status: int,
    body: str | None = None,
    *,
    phase: str = "submit",
) -> ModelErrorType:
    if status == 429:
        return ModelErrorType.RATE_LIMIT
    if status in (401, 403):
        return ModelErrorType.AUTH
    if status in (502, 503):
        return ModelErrorType.UNREACHED
    if status in (521, 522, 523, 525):
        return ModelErrorType.UNREACHED
    if status == 404 and phase in {"follow", "poll", "download"}:
        return ModelErrorType.JOB_NOT_FOUND
    if _looks_like_config_error(status, body):
        return ModelErrorType.CONFIG_ERROR
    if _looks_like_model_not_found(status, body):
        return ModelErrorType.MODEL_NOT_FOUND
    if status in (400, 404):
        return ModelErrorType.UNKNOWN
    if status >= 500:
        return ModelErrorType.MAYBE_BILLED
    return ModelErrorType.UNKNOWN


def classify_http(status: int) -> ModelErrorType:
    return classify_http_response(status)


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


def _exception_chain(exc: BaseException):
    seen: set[int] = set()
    current: BaseException | None = exc
    while current is not None and id(current) not in seen:
        yield current
        seen.add(id(current))
        current = current.__cause__ or current.__context__


def classify_exception(exc: BaseException) -> tuple[ModelErrorType, int | None, str]:
    """把没有 HTTP 状态行的传输失败收成策略输入。

    对端拆连接、连不上、写出失败:都还没拿到响应,按 UNREACHED(可同路重试)。
    OpenAI SDK 会把 httpx 连接失败包成 APIConnectionError,要沿异常链识别。
    读超时另算 TIMEOUT:请求可能已经离开本机,不能当成 52x。
    APITimeoutError 是 APIConnectionError 的子类,必须先按超时处理。
    """
    edge = str(exc)[:200]
    for item in _exception_chain(exc):
        status = getattr(item, "status_code", None)
        response = getattr(item, "response", None)
        if status is None and response is not None:
            status = getattr(response, "status_code", None)
        if isinstance(status, int):
            body = response.text if response is not None else None
            return classify_http_response(status, body), status, edge
        if isinstance(
            item,
            (APITimeoutError, httpx.ReadTimeout, httpx.TimeoutException, TimeoutError),
        ):
            return ModelErrorType.TIMEOUT, None, edge
        if isinstance(
            item,
            (
                APIConnectionError,
                httpx.RemoteProtocolError,
                httpx.LocalProtocolError,
                httpx.ConnectError,
                httpx.WriteError,
                httpx.NetworkError,
            ),
        ):
            return ModelErrorType.UNREACHED, None, edge
    return ModelErrorType.UNKNOWN, None, edge
