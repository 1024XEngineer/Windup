import logging

from windup_framework.gateway.context import bind_call_context, current_call_context
from windup_framework.gateway.trace import AttemptTrace, emit, estimate_cost
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


def test_trace_as_dict_has_required_keys():
    t = AttemptTrace(request_id="r1", scene=Scene.CHARACTER_IMAGE, model="gemini-2.5-flash-image")
    keys = set(t.as_dict())
    missing = REQUIRED - keys
    assert not missing, missing


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
    d = AttemptTrace(request_id="r", scene=Scene.CHARACTER_IMAGE, model="x", cost=None).as_dict()
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


def test_emit_logs_json_fields(caplog):
    caplog.set_level(logging.INFO, logger="windup.gateway")
    emit(AttemptTrace(request_id="r1", scene=Scene.CHARACTER_IMAGE, model="m"))
    assert "r1" in caplog.text
