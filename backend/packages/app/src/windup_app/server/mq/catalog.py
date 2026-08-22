"""MQ Stream 清单与并发配置。"""

from __future__ import annotations

import os
from dataclasses import dataclass

from windup_framework.mq.config import (
    EMAIL_HANDLER_RETRIES,
    GENERATION_PENDING_MAX_AGE_SECONDS,
    GENERATION_RUNNING_STALE_SECONDS,
)
from windup_framework.sse.bridge import SSE_REDIS_CHANNEL

EMAIL_STREAM = "windup:stream:email"
GENERATION_STREAM = "windup:stream:generation"

EMAIL_GROUP = "email"
GENERATION_GROUP = "generation"

MSG_TYPE_VERIFICATION_CODE = "verification_code"
MSG_TYPE_CHARACTER_IMAGE = "character_image"
MSG_TYPE_CHARACTER_ACTION = "character_action"
MSG_TYPE_CHARACTER_ACTION_POLL = "character_action_poll"


def _env_int(name: str, default: int) -> int:
    raw = os.getenv(name, "").strip()
    if not raw:
        return default
    return int(raw)


@dataclass(frozen=True)
class StreamSpec:
    stream: str
    group: str
    concurrency: int


def email_stream_spec() -> StreamSpec:
    return StreamSpec(
        stream=EMAIL_STREAM,
        group=EMAIL_GROUP,
        concurrency=_env_int("WINDUP_MQ_EMAIL_CONCURRENCY", 8),
    )


def generation_worker_pool_size() -> int:
    return (
        generation_image_concurrency()
        + generation_action_concurrency()
        + generation_poll_concurrency()
    )


def generation_stream_spec() -> StreamSpec:
    return StreamSpec(
        stream=GENERATION_STREAM,
        group=GENERATION_GROUP,
        concurrency=generation_worker_pool_size(),
    )


def generation_image_concurrency() -> int:
    # executor 已短 session:生成/上传不再占连接,默认不再被 15 连接池卡住。
    return _env_int("WINDUP_MQ_GENERATION_IMAGE_CONCURRENCY", 16)


def generation_action_concurrency() -> int:
    return _env_int("WINDUP_MQ_GENERATION_ACTION_CONCURRENCY", 8)


def generation_poll_concurrency() -> int:
    # 单次 inspect + 偶尔下载,不 sleep,默认高于 action 建单并发。
    return _env_int("WINDUP_MQ_GENERATION_POLL_CONCURRENCY", 16)


def all_stream_specs() -> tuple[StreamSpec, StreamSpec]:
    return email_stream_spec(), generation_stream_spec()


__all__ = [
    "EMAIL_STREAM",
    "EMAIL_GROUP",
    "EMAIL_HANDLER_RETRIES",
    "GENERATION_STREAM",
    "GENERATION_GROUP",
    "GENERATION_PENDING_MAX_AGE_SECONDS",
    "GENERATION_RUNNING_STALE_SECONDS",
    "MSG_TYPE_CHARACTER_ACTION",
    "MSG_TYPE_CHARACTER_ACTION_POLL",
    "MSG_TYPE_CHARACTER_IMAGE",
    "MSG_TYPE_VERIFICATION_CODE",
    "SSE_REDIS_CHANNEL",
    "StreamSpec",
    "all_stream_specs",
    "email_stream_spec",
    "generation_action_concurrency",
    "generation_image_concurrency",
    "generation_poll_concurrency",
    "generation_stream_spec",
    "generation_worker_pool_size",
]
