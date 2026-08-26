from __future__ import annotations

from windup_common.enums.model import ModelErrorType


def upstream_reached_label(
    error_type: ModelErrorType | None,
    *,
    http_status: int | None = None,
    ok: bool = False,
) -> str:
    if ok:
        return "true"
    if error_type is None:
        return "unknown"
    if error_type in {
        ModelErrorType.UNREACHED,
        ModelErrorType.NETWORK,
        ModelErrorType.MODEL_NOT_FOUND,
        ModelErrorType.CONFIG_ERROR,
        ModelErrorType.JOB_NOT_FOUND,
    }:
        return "false"
    if error_type is ModelErrorType.TIMEOUT and http_status is None:
        return "true"
    if error_type in {
        ModelErrorType.MAYBE_BILLED,
        ModelErrorType.INVALID_RESPONSE,
        ModelErrorType.UPSTREAM_FAILED,
    }:
        return "true"
    if error_type in {
        ModelErrorType.AUTH,
        ModelErrorType.RATE_LIMIT,
        ModelErrorType.UNKNOWN,
    }:
        return "true"
    return "unknown"


def billing_flags(
    *,
    error_type: ModelErrorType | None,
    http_status: int | None = None,
    ok: bool = False,
) -> bool:
    """Whether this attempt may incur upstream cost (ledger maybe_billed)."""
    if ok:
        return True
    if error_type is None:
        return False
    if error_type in {
        ModelErrorType.UNREACHED,
        ModelErrorType.NETWORK,
        ModelErrorType.AUTH,
        ModelErrorType.RATE_LIMIT,
        ModelErrorType.UNKNOWN,
        ModelErrorType.MODEL_NOT_FOUND,
        ModelErrorType.CONFIG_ERROR,
        ModelErrorType.JOB_NOT_FOUND,
    }:
        return False
    if error_type in {
        ModelErrorType.MAYBE_BILLED,
        ModelErrorType.TIMEOUT,
        ModelErrorType.UPSTREAM_FAILED,
    }:
        return True
    if error_type is ModelErrorType.INVALID_RESPONSE:
        return http_status is not None and http_status < 300
    return False
