from windup_common.enums.model import ModelErrorType
from windup_framework.gateway.classify import classify_http, retry_after_seconds


def test_522_is_unreached():
    assert classify_http(522) is ModelErrorType.UNREACHED
    assert classify_http(525) is ModelErrorType.UNREACHED
    assert classify_http(521) is ModelErrorType.UNREACHED
    assert classify_http(523) is ModelErrorType.UNREACHED


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
