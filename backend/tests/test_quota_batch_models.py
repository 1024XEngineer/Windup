# backend/tests/test_quota_batch_models.py
from datetime import datetime, timezone
from windup_app.server.quota.model import CreditBatch, CreditFreezeAlloc
from windup_common.enums.quota import CreditReason
from windup_framework.db import Base


def test_credit_batch_models():
    batch = CreditBatch(
        user_id=1, source_type=CreditReason.TOP_UP, total=100, remaining=100, frozen=0
    )
    alloc = CreditFreezeAlloc(
        freeze_ref="task:1", batch_id=1, amount=50
    )
    assert batch.is_exhausted == 0
    assert alloc.status == 1  # FROZEN

    # Test full attributes and tablename
    assert CreditBatch.__tablename__ == "windup_credit_batch"
    assert CreditFreezeAlloc.__tablename__ == "windup_credit_freeze_alloc"
    assert "windup_credit_batch" in Base.metadata.tables
    assert "windup_credit_freeze_alloc" in Base.metadata.tables

    # Check table indices
    batch_table = Base.metadata.tables["windup_credit_batch"]
    alloc_table = Base.metadata.tables["windup_credit_freeze_alloc"]
    batch_index_names = {idx.name for idx in batch_table.indexes}
    alloc_index_names = {idx.name for idx in alloc_table.indexes}
    assert "ix_credit_batch_user_exhausted_expires" in batch_index_names
    assert "ix_credit_freeze_alloc_ref_status" in alloc_index_names

    now = datetime.now(timezone.utc)
    batch_full = CreditBatch(
        id=10,
        user_id=2,
        source_type=CreditReason.SUBSCRIPTION,
        source_ref="order:sub_123",
        total=500,
        remaining=500,
        frozen=100,
        expires_at=now,
        is_exhausted=0,
    )
    assert batch_full.id == 10
    assert batch_full.user_id == 2
    assert batch_full.source_type == CreditReason.SUBSCRIPTION
    assert batch_full.source_ref == "order:sub_123"
    assert batch_full.total == 500
    assert batch_full.remaining == 500
    assert batch_full.frozen == 100
    assert batch_full.expires_at == now
    assert batch_full.is_exhausted == 0

    alloc_full = CreditFreezeAlloc(
        id=20,
        freeze_ref="task:gen_999",
        batch_id=10,
        amount=100,
        status=2,  # CAPTURED
    )
    assert alloc_full.id == 20
    assert alloc_full.freeze_ref == "task:gen_999"
    assert alloc_full.batch_id == 10
    assert alloc_full.amount == 100
    assert alloc_full.status == 2
