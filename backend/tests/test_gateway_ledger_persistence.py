from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

from windup_framework.db import Base
from windup_framework.gateway.ledger import persist_attempt
from windup_framework.gateway.models import AIGatewayAttempt, AIGatewayAttemptDetail
from windup_framework.gateway.trace import AttemptTrace
from windup_framework.gateway.types import Scene


def test_persist_attempt_splits_hot_and_detail_fields():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(
        engine,
        tables=[AIGatewayAttempt.__table__, AIGatewayAttemptDetail.__table__],
    )
    session_factory = sessionmaker(bind=engine, expire_on_commit=False)
    attempt_id = str(uuid.uuid4())

    persist_attempt(
        AttemptTrace(
            request_id="gw-1",
            attempt_id=attempt_id,
            task_id="42",
            user_id="7",
            scene=Scene.CHARACTER_IMAGE,
            model="gemini-2.5-flash-image",
            family="image.chat_data_uri",
            route_id="backup.fallback",
            route_group="character_image",
            candidate_index=1,
            provider_name="openai-compatible",
            base_url_id="backup",
            base_url_host="backup.example.com",
            api_key_id="backup",
            attempt_index=2,
            retry_count=1,
            route_reason="base_url_unreached",
            route_layer="base_url",
            circuit_scope=None,
            outcome="fallback_success",
            edge_fingerprint="cf-ray=abc",
            maybe_billed=True,
            cost=0.25,
            price_version="2026-08-16",
            provider_usage={"total_tokens": 12},
            started_at=datetime.now(timezone.utc).isoformat(),
            ended_at=datetime.now(timezone.utc).isoformat(),
            attempt_latency_ms=123,
        ),
        session_factory=session_factory,
    )

    with session_factory() as session:
        hot = session.scalar(select(AIGatewayAttempt))
        detail = session.scalar(select(AIGatewayAttemptDetail))

    assert hot is not None
    assert detail is not None
    assert hot.request_id == "gw-1"
    assert hot.task_id == 42
    assert hot.user_id == 7
    assert hot.base_url_id == "backup"
    assert hot.route_layer == "base_url"
    assert hot.outcome == "success"
    assert str(hot.attempt_id) == attempt_id
    assert detail.edge_fingerprint == "cf-ray=abc"
    assert detail.provider_usage == {"total_tokens": 12}
