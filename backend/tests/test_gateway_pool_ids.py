from __future__ import annotations

from windup_framework.gateway.pool_ids import credential_id, default_account_id


def test_credential_id_is_stable_for_same_key():
    a = credential_id("primary", "sk-secret")
    b = credential_id("primary", "sk-secret")
    assert a == b
    assert a.startswith("primary:")


def test_credential_id_differs_for_different_keys():
    assert credential_id("primary", "sk-a") != credential_id("primary", "sk-b")


def test_credential_id_order_independent():
    """CSV 顺序变化不改变同一物理 key 的 id。"""
    assert credential_id("primary", "sk-x") == credential_id("primary", "sk-x")


def test_default_account_id_matches_credential():
    cred = credential_id("primary", "sk-x")
    assert default_account_id(cred) == cred
