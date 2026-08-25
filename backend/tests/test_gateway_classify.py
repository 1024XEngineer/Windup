import httpx
from openai import APIConnectionError, APIStatusError, APITimeoutError

from windup_common.enums.model import ModelErrorType
from windup_framework.gateway.classify import (
    classify_exception,
    classify_http,
    classify_http_response,
    retry_after_seconds,
)


def test_522_is_unreached():
    assert classify_http(522) is ModelErrorType.UNREACHED
    assert classify_http(525) is ModelErrorType.UNREACHED
    assert classify_http(521) is ModelErrorType.UNREACHED
    assert classify_http(523) is ModelErrorType.UNREACHED


def test_remote_protocol_error_is_unreached():
    """对端未回任何 HTTP 状态行:与 52x 一样按未达源站,不当已计费。"""
    err = httpx.RemoteProtocolError("Server disconnected without sending a response")
    error_type, status, edge = classify_exception(err)
    assert error_type is ModelErrorType.UNREACHED
    assert status is None
    assert "disconnected" in edge


def test_502_and_503_are_unreached():
    assert classify_http(502) is ModelErrorType.UNREACHED
    assert classify_http(503) is ModelErrorType.UNREACHED


def test_520_and_524_are_maybe_billed():
    assert classify_http(520) is ModelErrorType.MAYBE_BILLED
    assert classify_http(524) is ModelErrorType.MAYBE_BILLED
    assert classify_http(500) is ModelErrorType.MAYBE_BILLED


def test_429_is_rate_limit():
    assert classify_http(429) is ModelErrorType.RATE_LIMIT


def test_401_is_auth():
    assert classify_http(401) is ModelErrorType.AUTH
    assert classify_http(403) is ModelErrorType.AUTH


def test_unreached_is_retryable_maybe_billed_is_not():
    assert ModelErrorType.UNREACHED.retryable
    assert ModelErrorType.RATE_LIMIT.retryable
    assert not ModelErrorType.MAYBE_BILLED.retryable
    assert not ModelErrorType.UPSTREAM_FAILED.retryable


def test_retry_after_seconds_number_and_cap():
    assert retry_after_seconds("2") == 2.0
    assert retry_after_seconds("300") == 30.0
    assert retry_after_seconds("invalid") is None
    assert retry_after_seconds("NaN") is None


def test_404_submit_model_not_found():
    body = '{"error":{"code":"model_not_found","message":"model x not found"}}'
    assert classify_http_response(404, body) is ModelErrorType.MODEL_NOT_FOUND


def test_404_submit_default_is_model_not_found():
    assert classify_http_response(404) is ModelErrorType.MODEL_NOT_FOUND


def test_404_follow_is_job_not_found():
    assert classify_http_response(404, phase="follow") is ModelErrorType.JOB_NOT_FOUND


def test_404_config_error_when_endpoint_wrong():
    body = '{"error":"invalid url: no route matched"}'
    assert classify_http_response(404, body) is ModelErrorType.CONFIG_ERROR


def test_openai_api_connection_error_is_unreached():
    req = httpx.Request("POST", "https://api.modelink.ai/v1/chat/completions")
    err = APIConnectionError(request=req)
    error_type, status, edge = classify_exception(err)
    assert error_type is ModelErrorType.UNREACHED
    assert status is None
    assert "Connection error" in edge


def test_openai_connection_error_uses_connect_cause():
    req = httpx.Request("POST", "https://api.modelink.ai/v1/chat/completions")
    err = APIConnectionError(request=req)
    err.__cause__ = httpx.ConnectError("Connection error", request=req)
    error_type, status, _ = classify_exception(err)
    assert error_type is ModelErrorType.UNREACHED
    assert status is None


def test_openai_connection_error_with_unknown_cause_is_unreached():
    req = httpx.Request("POST", "https://api.modelink.ai/v1/chat/completions")
    err = APIConnectionError(request=req)
    err.__cause__ = ValueError("hook failed")
    error_type, status, _ = classify_exception(err)
    assert error_type is ModelErrorType.UNREACHED
    assert status is None


def test_wrapped_connect_error_is_unreached():
    req = httpx.Request("POST", "https://api.modelink.ai/v1/chat/completions")
    cause = httpx.ConnectError("Connection error", request=req)
    wrapped = Exception("Connection error")
    wrapped.__cause__ = cause
    error_type, status, _ = classify_exception(wrapped)
    assert error_type is ModelErrorType.UNREACHED
    assert status is None


def test_openai_timeout_stays_timeout():
    req = httpx.Request("POST", "https://api.modelink.ai/v1/chat/completions")
    err = APITimeoutError(request=req)
    error_type, status, _ = classify_exception(err)
    assert error_type is ModelErrorType.TIMEOUT
    assert status is None


def test_http_status_error_classification_unchanged():
    req = httpx.Request("POST", "https://api.modelink.ai/v1/chat/completions")
    resp = httpx.Response(429, request=req)
    err = APIStatusError("quota", response=resp, body=None)
    error_type, status, _ = classify_exception(err)
    assert error_type is ModelErrorType.RATE_LIMIT
    assert status == 429


def test_unknown_exception_stays_unknown():
    error_type, status, edge = classify_exception(ValueError("weird"))
    assert error_type is ModelErrorType.UNKNOWN
    assert status is None
    assert edge == "weird"
