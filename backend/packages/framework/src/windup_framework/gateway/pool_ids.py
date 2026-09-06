"""凭证池稳定身份：与 CSV 下标、列表顺序无关。"""

from __future__ import annotations

import hashlib


def credential_id(endpoint_id: str, api_key: str) -> str:
    """``{endpoint_id}:{sha256(api_key)[:16]}`` — key 材料不变则 id 不变。"""
    endpoint = endpoint_id.strip() or "primary"
    digest = hashlib.sha256(api_key.encode()).hexdigest()[:16]
    return f"{endpoint}:{digest}"


def default_account_id(credential: str) -> str:
    """未单独建账号时，每把 key 自己一个账号（#842 / P0 默认）。"""
    return credential
