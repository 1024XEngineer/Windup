"""MQ catalog 配置单测。"""

from __future__ import annotations

import pytest

from windup_app.server.mq.catalog import (
    EMAIL_GROUP,
    EMAIL_STREAM,
    GENERATION_GROUP,
    GENERATION_STREAM,
    MSG_TYPE_CHARACTER_ACTION,
    MSG_TYPE_CHARACTER_ACTION_POLL,
    MSG_TYPE_CHARACTER_IMAGE,
    MSG_TYPE_VERIFICATION_CODE,
    POOL_POLL,
    POOL_SHARED,
    all_stream_specs,
    email_stream_spec,
    generation_action_concurrency,
    generation_image_concurrency,
    generation_poll_concurrency,
    generation_stream_spec,
    generation_worker_pool_size,
    msg_type_for_generation,
    type_spec,
    type_specs,
)


def test_email_stream_spec_defaults():
    spec = email_stream_spec()
    assert spec.stream == EMAIL_STREAM
    assert spec.group == EMAIL_GROUP
    assert spec.concurrency == 8


def test_generation_stream_spec_aggregates_pool_size():
    spec = generation_stream_spec()
    assert spec.stream == GENERATION_STREAM
    assert spec.group == GENERATION_GROUP
    assert spec.concurrency == generation_worker_pool_size()
    assert spec.concurrency == (
        generation_image_concurrency() + generation_action_concurrency()
    )


def test_default_generation_concurrency_is_the_documented_floor(monkeypatch):
    """短 session 后默认不再被 15 连接卡住;16 图 + 8 动作是面向多用户的底线。"""
    monkeypatch.delenv("WINDUP_MQ_GENERATION_IMAGE_CONCURRENCY", raising=False)
    monkeypatch.delenv("WINDUP_MQ_GENERATION_ACTION_CONCURRENCY", raising=False)
    monkeypatch.delenv("WINDUP_MQ_GENERATION_POLL_CONCURRENCY", raising=False)
    assert generation_image_concurrency() == 16
    assert generation_action_concurrency() == 8
    assert generation_poll_concurrency() == 16


def test_all_stream_specs_returns_email_and_generation():
    specs = all_stream_specs()
    assert len(specs) == 2
    assert specs[0].stream == EMAIL_STREAM
    assert specs[1].stream == GENERATION_STREAM


def test_catalog_respects_env_overrides(monkeypatch):
    monkeypatch.setenv("WINDUP_MQ_EMAIL_CONCURRENCY", "3")
    monkeypatch.setenv("WINDUP_MQ_GENERATION_IMAGE_CONCURRENCY", "10")
    monkeypatch.setenv("WINDUP_MQ_GENERATION_ACTION_CONCURRENCY", "5")
    monkeypatch.setenv("WINDUP_MQ_GENERATION_POLL_CONCURRENCY", "4")

    assert email_stream_spec().concurrency == 3
    assert generation_image_concurrency() == 10
    assert generation_action_concurrency() == 5
    assert generation_poll_concurrency() == 4
    assert generation_stream_spec().concurrency == 15


def test_type_specs_register_pool_limit_and_recover():
    by_type = {spec.msg_type: spec for spec in type_specs()}
    assert by_type[MSG_TYPE_VERIFICATION_CODE].stream == EMAIL_STREAM
    assert by_type[MSG_TYPE_VERIFICATION_CODE].pool == POOL_SHARED
    assert by_type[MSG_TYPE_VERIFICATION_CODE].limit is False
    assert by_type[MSG_TYPE_CHARACTER_IMAGE].pool == POOL_SHARED
    assert by_type[MSG_TYPE_CHARACTER_IMAGE].limit is True
    assert by_type[MSG_TYPE_CHARACTER_IMAGE].recover_as == MSG_TYPE_CHARACTER_IMAGE
    assert by_type[MSG_TYPE_CHARACTER_ACTION].recover_as == MSG_TYPE_CHARACTER_ACTION
    assert by_type[MSG_TYPE_CHARACTER_ACTION_POLL].pool == POOL_POLL
    assert by_type[MSG_TYPE_CHARACTER_ACTION_POLL].recover_as is None
    assert type_spec("unknown") is None


def test_msg_type_for_generation_skips_poll_types():
    assert msg_type_for_generation(MSG_TYPE_CHARACTER_IMAGE) == MSG_TYPE_CHARACTER_IMAGE
    assert msg_type_for_generation(MSG_TYPE_CHARACTER_ACTION) == MSG_TYPE_CHARACTER_ACTION
    with pytest.raises(ValueError, match="未知任务类型"):
        msg_type_for_generation(MSG_TYPE_CHARACTER_ACTION_POLL)


def test_handlers_cover_every_registered_type():
    from windup_app.worker.handlers import HANDLERS

    assert {spec.msg_type for spec in type_specs()} == set(HANDLERS)
