"""MQ catalog 配置单测。"""

from __future__ import annotations

import pytest

from windup_app.server.mq.catalog import (
    EMAIL_GROUP,
    EMAIL_STREAM,
    GENERATION_ACTION_GROUP,
    GENERATION_ACTION_STREAM,
    GENERATION_GROUP,
    GENERATION_IMAGE_GROUP,
    GENERATION_IMAGE_STREAM,
    GENERATION_STREAM,
    MSG_TYPE_CHARACTER_ACTION,
    MSG_TYPE_CHARACTER_ACTION_CLIENT_BAKE,
    MSG_TYPE_CHARACTER_ACTION_POLL,
    MSG_TYPE_CHARACTER_IMAGE,
    MSG_TYPE_VERIFICATION_CODE,
    POOL_POLL,
    POOL_SHARED,
    all_stream_specs,
    email_stream_spec,
    generation_action_concurrency,
    generation_action_stream_spec,
    generation_image_concurrency,
    generation_image_stream_spec,
    generation_poll_concurrency,
    generation_stream_spec,
    generation_worker_pool_size,
    msg_type_for_generation,
    stream_for_msg_type,
    type_spec,
    type_specs,
    types_for_stream,
)


def test_email_stream_spec_defaults():
    spec = email_stream_spec()
    assert spec.stream == EMAIL_STREAM
    assert spec.group == EMAIL_GROUP
    assert spec.concurrency == 8


def test_generation_streams_are_split_and_drain_keeps_old_key():
    image = generation_image_stream_spec()
    action = generation_action_stream_spec()
    drain = generation_stream_spec()
    assert image.stream == GENERATION_IMAGE_STREAM
    assert image.group == GENERATION_IMAGE_GROUP
    assert image.concurrency == generation_image_concurrency()
    assert action.stream == GENERATION_ACTION_STREAM
    assert action.group == GENERATION_ACTION_GROUP
    assert action.concurrency == generation_action_concurrency()
    assert drain.stream == GENERATION_STREAM
    assert drain.group == GENERATION_GROUP
    assert drain.concurrency == generation_worker_pool_size()
    assert drain.concurrency == (
        generation_image_concurrency() + generation_action_concurrency()
    )


def test_default_generation_concurrency_matches_production_floor(monkeypatch):
    monkeypatch.delenv("WINDUP_MQ_GENERATION_IMAGE_CONCURRENCY", raising=False)
    monkeypatch.delenv("WINDUP_MQ_GENERATION_ACTION_CONCURRENCY", raising=False)
    monkeypatch.delenv("WINDUP_MQ_GENERATION_POLL_CONCURRENCY", raising=False)
    assert generation_image_concurrency() == 4
    assert generation_action_concurrency() == 2
    assert generation_poll_concurrency() == 2


def test_all_stream_specs_returns_email_image_and_action():
    specs = all_stream_specs()
    assert [spec.stream for spec in specs] == [
        EMAIL_STREAM,
        GENERATION_IMAGE_STREAM,
        GENERATION_ACTION_STREAM,
    ]


def test_catalog_respects_env_overrides(monkeypatch):
    monkeypatch.setenv("WINDUP_MQ_EMAIL_CONCURRENCY", "3")
    monkeypatch.setenv("WINDUP_MQ_GENERATION_IMAGE_CONCURRENCY", "10")
    monkeypatch.setenv("WINDUP_MQ_GENERATION_ACTION_CONCURRENCY", "5")
    monkeypatch.setenv("WINDUP_MQ_GENERATION_POLL_CONCURRENCY", "4")

    assert email_stream_spec().concurrency == 3
    assert generation_image_concurrency() == 10
    assert generation_action_concurrency() == 5
    assert generation_poll_concurrency() == 4
    assert generation_image_stream_spec().concurrency == 10
    assert generation_action_stream_spec().concurrency == 5
    assert generation_stream_spec().concurrency == 15


def test_type_specs_register_pool_limit_recover_and_stream():
    by_type = {spec.msg_type: spec for spec in type_specs()}
    assert by_type[MSG_TYPE_VERIFICATION_CODE].stream == EMAIL_STREAM
    assert by_type[MSG_TYPE_VERIFICATION_CODE].pool == POOL_SHARED
    assert by_type[MSG_TYPE_VERIFICATION_CODE].limit is False
    assert by_type[MSG_TYPE_CHARACTER_IMAGE].stream == GENERATION_IMAGE_STREAM
    assert by_type[MSG_TYPE_CHARACTER_IMAGE].pool == POOL_SHARED
    assert by_type[MSG_TYPE_CHARACTER_IMAGE].limit is True
    assert by_type[MSG_TYPE_CHARACTER_IMAGE].recover_as == MSG_TYPE_CHARACTER_IMAGE
    assert by_type[MSG_TYPE_CHARACTER_ACTION].stream == GENERATION_ACTION_STREAM
    assert by_type[MSG_TYPE_CHARACTER_ACTION].recover_as == MSG_TYPE_CHARACTER_ACTION
    assert by_type[MSG_TYPE_CHARACTER_ACTION_POLL].stream == GENERATION_ACTION_STREAM
    assert by_type[MSG_TYPE_CHARACTER_ACTION_POLL].pool == POOL_POLL
    assert by_type[MSG_TYPE_CHARACTER_ACTION_POLL].recover_as is None
    assert by_type[MSG_TYPE_CHARACTER_ACTION_CLIENT_BAKE].stream == GENERATION_ACTION_STREAM
    assert type_spec("unknown") is None


def test_stream_for_msg_type_routes_image_and_action():
    assert stream_for_msg_type(MSG_TYPE_CHARACTER_IMAGE) == GENERATION_IMAGE_STREAM
    assert stream_for_msg_type(MSG_TYPE_CHARACTER_ACTION) == GENERATION_ACTION_STREAM
    assert stream_for_msg_type(MSG_TYPE_CHARACTER_ACTION_POLL) == GENERATION_ACTION_STREAM
    assert stream_for_msg_type(MSG_TYPE_CHARACTER_ACTION_CLIENT_BAKE) == GENERATION_ACTION_STREAM
    assert stream_for_msg_type(MSG_TYPE_VERIFICATION_CODE) == EMAIL_STREAM
    with pytest.raises(ValueError, match="未知消息类型"):
        stream_for_msg_type("unknown")


def test_legacy_generation_stream_still_sees_image_and_action_types():
    names = {spec.msg_type for spec in types_for_stream(GENERATION_STREAM)}
    assert names >= {
        MSG_TYPE_CHARACTER_IMAGE,
        MSG_TYPE_CHARACTER_ACTION,
        MSG_TYPE_CHARACTER_ACTION_POLL,
        MSG_TYPE_CHARACTER_ACTION_CLIENT_BAKE,
    }
    assert MSG_TYPE_VERIFICATION_CODE not in names


def test_msg_type_for_generation_skips_poll_types():
    assert msg_type_for_generation(MSG_TYPE_CHARACTER_IMAGE) == MSG_TYPE_CHARACTER_IMAGE
    assert msg_type_for_generation("character_direction_set") == MSG_TYPE_CHARACTER_IMAGE
    assert msg_type_for_generation("character_four_view") == MSG_TYPE_CHARACTER_IMAGE
    assert msg_type_for_generation("character_eight_view") == MSG_TYPE_CHARACTER_IMAGE
    assert msg_type_for_generation(MSG_TYPE_CHARACTER_ACTION) == MSG_TYPE_CHARACTER_ACTION
    with pytest.raises(ValueError, match="未知任务类型"):
        msg_type_for_generation(MSG_TYPE_CHARACTER_ACTION_POLL)


def test_handlers_cover_every_registered_type():
    from windup_app.worker.handlers import HANDLERS

    assert {spec.msg_type for spec in type_specs()} == set(HANDLERS)
