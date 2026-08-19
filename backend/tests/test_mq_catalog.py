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
    assert spec.concurrency == generation_image_concurrency() + generation_action_concurrency()
    assert spec.concurrency <= 10


def test_default_generation_concurrency_fits_default_pool():
    """默认 handler 并发不应超过 .env.example 中的连接池容量 (5+10)。"""
    assert generation_image_concurrency() + generation_action_concurrency() <= 15


def test_all_stream_specs_returns_email_and_generation():
    specs = all_stream_specs()
    assert len(specs) == 2
    assert specs[0].stream == EMAIL_STREAM
    assert specs[1].stream == GENERATION_STREAM


def test_catalog_respects_env_overrides(monkeypatch):
    monkeypatch.setenv("WINDUP_MQ_EMAIL_CONCURRENCY", "3")
    monkeypatch.setenv("WINDUP_MQ_GENERATION_IMAGE_CONCURRENCY", "10")
    monkeypatch.setenv("WINDUP_MQ_GENERATION_ACTION_CONCURRENCY", "5")

    assert email_stream_spec().concurrency == 3
    assert generation_image_concurrency() == 10
    assert generation_action_concurrency() == 5
    assert generation_stream_spec().concurrency == 15
