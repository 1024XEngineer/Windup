"""AuthMiddleware 鉴权测试。

覆盖 token 过期 / 无效 / 缺失等场景，确保返回 HTTP 200 + 业务码 401。
"""

from datetime import datetime, timezone

import jwt

from windup_app.server.user.service import (
    JWT_ALGORITHM,
    JWT_SECRET,
)


def _make_expired_token(user_id: int = 1, email: str = "test@example.com") -> str:
    """生成一个已过期的 access_token（exp 设在1小时之前）。"""
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(user_id),
        "email": email,
        "type": "access",
        "iat": now,
        "exp": now.timestamp() - 3600,  # 1小时前过期
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def _make_invalid_signature_token(user_id: int = 1, email: str = "test@example.com") -> str:
    """生成一个签名无效的 token（用错误的密钥签发）。"""
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(user_id),
        "email": email,
        "type": "access",
        "iat": now,
        "exp": now.timestamp() + 900,
    }
    return jwt.encode(payload, "wrong-secret-key", algorithm=JWT_ALGORITHM)


class TestAuthMiddlewareTokenValidation:
    """token 验证相关用例。"""

    def test_expired_token_returns_401(self, client):
        """已过期的 access token 应返回 HTTP 200 + code=401。"""
        token = _make_expired_token()
        resp = client.get(
            "/media/list",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["code"] == 401
        assert "已过期" in body["message"]

    def test_invalid_signature_token_returns_401(self, client):
        """签名无效的 token 应返回 HTTP 200 + code=401。"""
        token = _make_invalid_signature_token()
        resp = client.get(
            "/media/list",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["code"] == 401
        assert "无效" in body["message"]

    def test_missing_auth_header_returns_401(self, client):
        """未携带 Authorization header 应返回 HTTP 200 + code=401。"""
        resp = client.get("/media/list")
        assert resp.status_code == 200
        body = resp.json()
        assert body["code"] == 401

    def test_malformed_auth_header_returns_401(self, client):
        """Authorization header 格式错误（无 Bearer 前缀）应返回 401。"""
        resp = client.get(
            "/media/list",
            headers={"Authorization": "Token abc123"},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["code"] == 401

    def test_valid_token_passes_through(self, auth_client):
        """有效的 access token 应正常通过鉴权。"""
        resp = auth_client.get("/media/list")
        # 不是 401 就算通过（可能是业务层的其他状态码）
        assert resp.json().get("code") != 401

    def test_whitelist_path_no_auth(self, client):
        """白名单路径不需要鉴权。"""
        resp = client.get("/health")
        # 白名单路径不应返回 401
        assert resp.json().get("code") != 401
