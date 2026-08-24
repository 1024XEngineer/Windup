"""MQ catalog 配置单测。"""

from __future__ import annotations

from windup_app.server.mq.catalog import (
    EMAIL_GROUP,
    EMAIL_STREAM,
    GENERATION_GROUP,
    GENERATION_STREAM,
    all_stream_specs,
    email_stream_spec,
    generation_action_concurrency,
    generation_image_concurrency,
    generation_poll_concurrency,
    generation_stream_spec,
    generation_worker_pool_size,
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
