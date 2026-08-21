import json
import logging
from dataclasses import fields

from windup_framework.gateway.context import bind_call_context, current_call_context
from windup_framework.gateway.routes import GatewayRoute
from windup_framework.gateway.trace import AttemptDetail, AttemptTrace, emit, estimate_cost
from windup_framework.gateway.types import Scene

REQUIRED = {
    "request_id", "attempt_id", "task_id", "user_id", "scene", "model", "family",
    "route_id", "route_group", "candidate_index", "provider_name", "base_url_id",
    "base_url_host", "api_key_id", "attempt_index", "retry_count", "route_reason",
    "route_layer", "circuit_scope",
    "error_type", "http_status", "edge_fingerprint", "job_id", "fallback_used",
    "outcome", "job_status", "started_at", "ended_at", "attempt_latency_ms",
    "total_latency_ms", "submit_ms", "poll_ms", "download_ms", "poll_count",
    "retry_after_ms", "resend_spent", "output_bytes", "expected_bytes",
    "input_hash", "output_hash", "maybe_billed", "cost", "price_version",
    "provider_usage",
}

COLD_FIELDS = {
    "input_hash", "output_hash", "output_bytes", "expected_bytes",
    "retry_after_ms", "submit_ms", "poll_ms", "download_ms", "poll_count",
    "resend_spent", "job_status", "edge_fingerprint", "provider_usage",
}


def _route(**overrides) -> GatewayRoute:
    fields_ = dict(
        route_id="primary.key0",
        route_group="character_image",
        candidate_index=0,
        provider_name="openai-compatible",
        base_url_id="primary",
        base_url="https://api.qnaigc.com/v1",
        api_key_id="primary.key0",
        api_key="k",
    )
    fields_.update(overrides)
    return GatewayRoute(**fields_)


def _trace(**overrides) -> AttemptTrace:
    fields_ = dict(
        request_id="r1",
        scene=Scene.CHARACTER_IMAGE,
        model="gemini-2.5-flash-image",
        route=_route(),
        attempt_index=0,
        retry_count=0,
        route_reason="primary",
        outcome="success",
    )
    fields_.update(overrides)
    return AttemptTrace(**fields_)


def test_cold_fields_live_on_detail_not_trace():
    names = {f.name for f in fields(AttemptTrace)}
    assert "route" in names
    assert "detail" in names
    assert COLD_FIELDS.isdisjoint(names)
    assert "route_id" not in names
    assert "route_layer" not in names


def test_trace_as_dict_has_required_keys():
    t = _trace()
    keys = set(t.as_dict())
    missing = REQUIRED - keys
    assert not missing, missing
    assert "route" not in keys
    assert "detail" not in keys


def test_as_dict_flattens_route_and_detail():
    t = _trace(
        route=_route(base_url_id="backup", route_id="backup.key0"),
        route_reason="base_url_unreached",
        detail=AttemptDetail(input_hash="abc", submit_ms=12, provider_usage={"n": 1}),
    )
    d = t.as_dict()
    assert d["base_url_id"] == "backup"
    assert d["route_id"] == "backup.key0"
    assert d["route_layer"] == "base_url"
    assert d["input_hash"] == "abc"
    assert d["submit_ms"] == 12
    assert d["provider_usage"] == {"n": 1}


def test_cost_null_when_unpriced():
    assert estimate_cost(Scene.CHARACTER_IMAGE, billed=True, seconds=5,
                         image_unit_cost=None, video_unit_cost_per_second=None) is None
    assert estimate_cost(Scene.CHARACTER_IMAGE, billed=True, seconds=5,
                         image_unit_cost=0.02, video_unit_cost_per_second=None) == 0.02
    assert estimate_cost(Scene.CHARACTER_IMAGE, billed=False, seconds=5,
                         image_unit_cost=0.02, video_unit_cost_per_second=None) is None
    assert estimate_cost(Scene.CHARACTER_ACTION, billed=True, seconds=5,
                         image_unit_cost=None, video_unit_cost_per_second=0.1) == 0.5


def test_cost_never_emits_zero_for_missing_price():
    d = _trace(model="x", cost=None).as_dict()
    assert d["cost"] is None


def test_context_bind_and_reset():
    assert current_call_context().request_id is None
    tok = bind_call_context(request_id="abc", task_id="1", user_id="9", start_from_model="kling-v2-6")
    try:
        assert current_call_context().request_id == "abc"
        assert current_call_context().start_from_model == "kling-v2-6"
    finally:
        tok()
    assert current_call_context().request_id is None


def test_emit_fills_ids_from_context(caplog):
    caplog.set_level(logging.INFO, logger="windup.gateway")
    tok = bind_call_context(request_id="abc", task_id="1", user_id="9")
    try:
        emit(_trace(request_id="r1", family="image.chat_data_uri"))
    finally:
        tok()
    records = [json.loads(r.message) for r in caplog.records if r.name == "windup.gateway"]
    assert records
    line = records[-1]
    assert line["request_id"] == "r1"
    assert line["task_id"] == "1"
    assert line["user_id"] == "9"
    assert line["attempt_id"]
    assert line["price_version"]
    assert line["family"] == "image.chat_data_uri"


def test_emit_logs_json_fields(caplog):
    caplog.set_level(logging.INFO, logger="windup.gateway")
    emit(_trace(request_id="r1", model="m"))
    assert "r1" in caplog.text
