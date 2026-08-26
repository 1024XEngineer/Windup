"""MQ Stream 清单、消息类型注册与并发配置。

加一种 generation ``msg_type`` 时只改这里的 :func:`type_specs`，再在
``windup_app.worker.handlers`` 登记 handler。不要改 consumer 的提交路径：
它按本表选线程池和信号量。

步骤::

    1. 增加 ``MSG_TYPE_*`` 常量
    2. 在 :func:`type_specs` 加一条 :class:`TypeSpec`
       - ``pool=POOL_SHARED``：与同 Stream 其它共享池类型共用执行器
       - ``pool`` 换新名字：独立线程池（如 poll，避免被 image 占满）
       - ``limit=True``：该类型单独信号量，并发即 ``concurrency``
       - ``recover_as``：PENDING 任务按此 GenerationType 值重入队；轮询类留 None
    3. 在 handlers 的 ``HANDLERS`` 登记可调用对象

不在此表里塞积分账本或 SSE EventBus。是否新开 Stream 仍按 SLA 决定。
"""

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
MSG_TYPE_CHARACTER_ACTION_CLIENT_BAKE = "character_action_client_bake"

POOL_SHARED = "shared"
POOL_POLL = "poll"


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


@dataclass(frozen=True)
class TypeSpec:
    """Stream 内一种 ``msg_type`` 的并发池、信号量与恢复策略。"""

    msg_type: str
    stream: str
    pool: str
    concurrency: int
    limit: bool
    recover_as: str | None = None


def generation_image_concurrency() -> int:
    # executor 已短 session:生成/上传不再占连接,默认不再被 15 连接池卡住。
    return _env_int("WINDUP_MQ_GENERATION_IMAGE_CONCURRENCY", 16)


def generation_action_concurrency() -> int:
    return _env_int("WINDUP_MQ_GENERATION_ACTION_CONCURRENCY", 8)


def generation_poll_concurrency() -> int:
    # 单次 inspect + 偶尔下载,不 sleep,默认高于 action 建单并发。
    return _env_int("WINDUP_MQ_GENERATION_POLL_CONCURRENCY", 16)


def type_specs() -> tuple[TypeSpec, ...]:
    return (
        TypeSpec(
            msg_type=MSG_TYPE_VERIFICATION_CODE,
            stream=EMAIL_STREAM,
            pool=POOL_SHARED,
            concurrency=_env_int("WINDUP_MQ_EMAIL_CONCURRENCY", 8),
            limit=False,
        ),
        TypeSpec(
            msg_type=MSG_TYPE_CHARACTER_IMAGE,
            stream=GENERATION_STREAM,
            pool=POOL_SHARED,
            concurrency=generation_image_concurrency(),
            limit=True,
            recover_as=MSG_TYPE_CHARACTER_IMAGE,
        ),
        TypeSpec(
            msg_type=MSG_TYPE_CHARACTER_ACTION,
            stream=GENERATION_STREAM,
            pool=POOL_SHARED,
            concurrency=generation_action_concurrency(),
            limit=True,
            recover_as=MSG_TYPE_CHARACTER_ACTION,
        ),
        TypeSpec(
            msg_type=MSG_TYPE_CHARACTER_ACTION_POLL,
            stream=GENERATION_STREAM,
            pool=POOL_POLL,
            concurrency=generation_poll_concurrency(),
            limit=True,
        ),
        TypeSpec(
            msg_type=MSG_TYPE_CHARACTER_ACTION_CLIENT_BAKE,
            stream=GENERATION_STREAM,
            pool=POOL_POLL,
            concurrency=generation_poll_concurrency(),
            limit=True,
        ),
    )


def type_spec(msg_type: str) -> TypeSpec | None:
    for spec in type_specs():
        if spec.msg_type == msg_type:
            return spec
    return None


def types_for_stream(stream: str) -> tuple[TypeSpec, ...]:
    return tuple(spec for spec in type_specs() if spec.stream == stream)


def msg_type_for_generation(task_type: str) -> str:
    """PENDING 重入队 / API 投递用的 msg_type。轮询类型没有 recover_as。"""
    if task_type in (
        "character_direction_set",
        "character_four_view",
        "character_eight_view",
    ):
        # 与单张立绘同一图像并发池。payload.task_type 才是执行器分叉,
        # 不要另开 TypeSpec,否则会把线程池和信号量再加一倍。
        return MSG_TYPE_CHARACTER_IMAGE
    for spec in type_specs():
        if spec.recover_as == task_type:
            return spec.msg_type
    raise ValueError(f"未知任务类型: {task_type}")


def _pool_size(stream: str, pool: str) -> int:
    return sum(
        spec.concurrency
        for spec in type_specs()
        if spec.stream == stream and spec.pool == pool
    )


def email_stream_spec() -> StreamSpec:
    return StreamSpec(
        stream=EMAIL_STREAM,
        group=EMAIL_GROUP,
        concurrency=_pool_size(EMAIL_STREAM, POOL_SHARED),
    )


def generation_worker_pool_size() -> int:
    # image/action 共用一个线程池。poll 走独立 pool 名,不能加进这个数字,
    # 否则 image 占满线程后 poll 只能排队。
    return _pool_size(GENERATION_STREAM, POOL_SHARED)


def generation_stream_spec() -> StreamSpec:
    return StreamSpec(
        stream=GENERATION_STREAM,
        group=GENERATION_GROUP,
        concurrency=generation_worker_pool_size(),
    )


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
    "POOL_POLL",
    "POOL_SHARED",
    "SSE_REDIS_CHANNEL",
    "StreamSpec",
    "TypeSpec",
    "all_stream_specs",
    "email_stream_spec",
    "generation_action_concurrency",
    "generation_image_concurrency",
    "generation_poll_concurrency",
    "generation_stream_spec",
    "generation_worker_pool_size",
    "msg_type_for_generation",
    "type_spec",
    "type_specs",
    "types_for_stream",
]
