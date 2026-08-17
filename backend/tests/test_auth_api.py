"""认证 API：覆盖 login / 验证码登录 / 改密 / 重置密码 / 改昵称调用链。"""

from unittest.mock import MagicMock

import pytest

from windup_app.server.user.model import User
from windup_app.server.user.service import _hash_password, service


@pytest.fixture()
def mock_user_redis():
    """把模块级 user service 的 Redis 换成 mock，避免打到真实实例。"""
    redis_mock = MagicMock()
    redis_mock.get.return_value = None
    redis_mock.setex.return_value = True
    redis_mock.delete.return_value = True
    redis_mock.scan_iter.return_value = iter([])
    previous = service._redis
    service._redis = redis_mock
    yield redis_mock
    service._redis = previous


@pytest.fixture()
def seeded_user(db_session):
    """与 auth_client token 对齐的用户（id=1）。"""
    user = User(
        id=1,
        email="test@example.com",
        password_hash=_hash_password("password123"),
        nickname="旧昵称",
    )
    db_session.add(user)
    db_session.flush()
    return user


def test_login_by_password_endpoint(client, seeded_user, mock_user_redis):
    resp = client.post(
        "/auth/login",
        json={"email": "test@example.com", "password": "password123"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["code"] == 200
    assert body["message"] == "登录成功"
    assert body["data"]["user"]["email"] == "test@example.com"
    assert body["data"]["access_token"]
    assert body["data"]["refresh_token"]


def test_login_by_code_endpoint(client, seeded_user, mock_user_redis):
    mock_user_redis.get.return_value = "123456"
    resp = client.post(
        "/auth/login-by-code",
        json={"email": "test@example.com", "code": "123456"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["code"] == 200
    assert body["message"] == "登录成功"
    assert body["data"]["user"]["email"] == "test@example.com"
    assert body["data"]["access_token"]


def test_change_password_endpoint(auth_client, seeded_user, mock_user_redis):
    resp = auth_client.post(
        "/auth/change-password",
        json={"old_password": "password123", "new_password": "newpass123"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["code"] == 200
    assert body["message"] == "密码修改成功"


def test_reset_password_endpoint(auth_client, seeded_user, mock_user_redis):
    mock_user_redis.get.return_value = "654321"
    resp = auth_client.post(
        "/auth/reset-password",
        json={
            "email": "test@example.com",
            "code": "654321",
            "new_password": "resetpass1",
        },
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["code"] == 200
    assert body["message"] == "密码重置成功"


def test_update_nickname_endpoint(auth_client, seeded_user, mock_user_redis):
    resp = auth_client.patch("/auth/profile", json={"nickname": "新昵称"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["code"] == 200
    assert body["message"] == "昵称修改成功"
    assert body["data"]["nickname"] == "新昵称"
    assert body["data"]["email"] == "test@example.com"
