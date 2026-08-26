from __future__ import annotations

from sqlalchemy import create_engine, inspect

from windup_framework.db import Base
from windup_framework.gateway.models import AIGatewayAttempt, AIGatewayAttemptDetail


def test_gateway_ledger_tables_are_registered_and_split_hot_detail():
    assert AIGatewayAttempt.__tablename__ == "windup_ai_gateway_attempt"
    assert AIGatewayAttemptDetail.__tablename__ == "windup_ai_gateway_attempt_detail"

    attempt_cols = set(AIGatewayAttempt.__table__.columns.keys())
    detail_cols = set(AIGatewayAttemptDetail.__table__.columns.keys())

    # Hot table: compact router/cost fields used by key/url/model health queries.
    assert {
        "request_id",
        "attempt_id",
        "route_id",
        "route_group",
        "candidate_index",
        "provider_name",
        "base_url_id",
        "base_url_host",
        "api_key_id",
        "model",
        "route_layer",
        "error_type",
        "maybe_billed",
        "estimated_cost",
    } <= attempt_cols

    # Cold table: larger troubleshooting fields stay out of the hot path.
    assert {
        "attempt_id",
        "edge_fingerprint",
        "error_message",
        "provider_request_id",
        "provider_usage",
        "submit_ms",
        "poll_ms",
        "download_ms",
        "extra",
    } <= detail_cols
    assert "provider_usage" not in attempt_cols
    assert "edge_fingerprint" not in attempt_cols


def test_gateway_ledger_tables_can_be_created_in_test_db():
    engine = create_engine("sqlite:///:memory:")
    try:
        Base.metadata.create_all(
            engine,
            tables=[AIGatewayAttempt.__table__, AIGatewayAttemptDetail.__table__],
        )
        tables = set(inspect(engine).get_table_names())
        assert "windup_ai_gateway_attempt" in tables
        assert "windup_ai_gateway_attempt_detail" in tables
    finally:
        engine.dispose()
