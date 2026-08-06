"""``SqlAlchemyUserService`` 单元测试。

用 SQLite 内存库 + mock Redis + mock 邮件服务做隔离，不依赖外部服务。
"""

import pytest
from unittest.mock import MagicMock, patch

from windup_common.exceptions import BizException

from windup_app.server.user.model import (
    ChangePasswordInput,
    LoginByCodeInput,
    LoginByPasswordInput,
    RegisterInput,
    User,
    UserStatus,
)
from windup_app.server.user.service import (
    SqlAlchemyUserService,
    _hash_password,
    _verify_password,
    create_access_token,
    create_refresh_token,
    decode_token,
)


# -- Fixtures ------------------------------------------------------------


@pytest.fixture()
def mock_redis():
    """Mock Redis 客户端。"""
    redis_mock = MagicMock()
    redis_mock.get.return_value = None
    redis_mock.setex.return_value = True
    redis_mock.delete.return_value = True
    redis_mock.pipeline.return_value = MagicMock(
        execute=MagicMock(return_value=[True, True])
    )
    return redis_mock


@pytest.fixture()
def service(mock_redis):
    """带 mock Redis 的 UserService 实例。"""
    svc = SqlAlchemyUserService()
    svc._redis = mock_redis
    return svc


@pytest.fixture()
def mock_email():
    """Mock 邮件服务。"""
    with patch("windup_app.server.user.service.email_provider") as mock:
        yield mock


# -- 密码哈希测试 --------------------------------------------------------


def test_hash_password():
    hashed = _hash_password("test123")
    assert hashed != "test123"
    assert _verify_password("test123", hashed) is True


def test_verify_password_wrong():
    hashed = _hash_password("test123")
    assert _verify_password("wrong", hashed) is False


# -- JWT 测试 ------------------------------------------------------------


def test_create_and_decode_access_token():
    token = create_access_token(1, "test@example.com")
    payload = decode_token(token)

    assert payload["sub"] == "1"
    assert payload["email"] == "test@example.com"
    assert payload["type"] == "access"


def test_create_and_decode_refresh_token():
    token, jti = create_refresh_token(1, "test@example.com")
    payload = decode_token(token)

    assert payload["sub"] == "1"
    assert payload["email"] == "test@example.com"
    assert payload["type"] == "refresh"
    assert payload["jti"] == jti


def test_decode_expired_token():
    import jwt
    from datetime import datetime, timezone
    from windup_app.server.user.service import JWT_SECRET

    # 创建一个已过期的 token
    payload = {
        "sub": "1",
        "type": "access",
        "exp": datetime.now(timezone.utc).timestamp() - 100,
    }
    token = jwt.encode(payload, JWT_SECRET, algorithm="HS256")

    with pytest.raises(BizException, match="token 已过期"):
        decode_token(token)


def test_decode_invalid_token():
    with pytest.raises(BizException, match="token 无效"):
        decode_token("invalid-token")


# -- 注册测试 ------------------------------------------------------------


def test_register_success(db_session, service, mock_email):
    # Mock Redis 验证码
    service._redis.get.return_value = "123456"

    input_data = RegisterInput(
        email="new@example.com",
        password="password123",
        code="123456",
    )

    result = service.register_by_email_with_session(db_session, input_data)

    assert result.user.email == "new@example.com"
    assert result.access_token is not None
    assert result.refresh_token is not None
    assert result.user.email_verified_at is not None  # 注册即验证


def test_register_duplicate_email(db_session, service):
    # 先注册一个用户
    service._redis.get.return_value = "123456"
    input_data = RegisterInput(email="dup@example.com", password="pass123", code="123456")
    service.register_by_email_with_session(db_session, input_data)

    # 尝试重复注册
    with pytest.raises(BizException, match="邮箱已注册"):
        service.register_by_email_with_session(db_session, input_data)


def test_register_wrong_code(db_session, service):
    service._redis.get.return_value = "123456"

    input_data = RegisterInput(
        email="new@example.com",
        password="password123",
        code="999999",  # 错误验证码
    )

    with pytest.raises(BizException, match="验证码错误"):
        service.register_by_email_with_session(db_session, input_data)


def test_register_expired_code(db_session, service):
    service._redis.get.return_value = None  # 验证码已过期

    input_data = RegisterInput(
        email="new@example.com",
        password="password123",
        code="123456",
    )

    with pytest.raises(BizException, match="验证码已过期"):
        service.register_by_email_with_session(db_session, input_data)


# -- 登录测试 ------------------------------------------------------------


def test_login_success(db_session, service, mock_email):
    # 先注册
    service._redis.get.return_value = "123456"
    register_input = RegisterInput(email="login@example.com", password="pass123", code="123456")
    service.register_by_email_with_session(db_session, register_input)

    # 登录
    service._redis.get.return_value = "654321"
    login_input = LoginByPasswordInput(email="login@example.com", password="pass123", code="654321")
    result = service.login_by_password_with_session(db_session, login_input)

    assert result.user.email == "login@example.com"
    assert result.access_token is not None


def test_login_wrong_password(db_session, service, mock_email):
    # 先注册
    service._redis.get.return_value = "123456"
    register_input = RegisterInput(email="login@example.com", password="pass123", code="123456")
    service.register_by_email_with_session(db_session, register_input)

    # 密码错误
    service._redis.get.return_value = "654321"
    login_input = LoginByPasswordInput(email="login@example.com", password="wrong", code="654321")

    with pytest.raises(BizException, match="邮箱或密码错误"):
        service.login_by_password_with_session(db_session, login_input)


def test_login_nonexistent_user(db_session, service):
    service._redis.get.return_value = "123456"
    login_input = LoginByPasswordInput(email="no@example.com", password="pass123", code="123456")

    with pytest.raises(BizException, match="邮箱或密码错误"):
        service.login_by_password_with_session(db_session, login_input)


def test_login_banned_user(db_session, service, mock_email):
    # 先注册
    service._redis.get.return_value = "123456"
    register_input = RegisterInput(email="banned@example.com", password="pass123", code="123456")
    service.register_by_email_with_session(db_session, register_input)

    # 封禁用户
    from sqlalchemy import select
    user = db_session.scalar(select(User).where(User.email == "banned@example.com"))
    user.status = UserStatus.BANNED
    db_session.flush()

    # 尝试登录
    service._redis.get.return_value = "654321"
    login_input = LoginByPasswordInput(email="banned@example.com", password="pass123", code="654321")

    with pytest.raises(BizException, match="账号已被封禁"):
        service.login_by_password_with_session(db_session, login_input)


# -- 验证码登录测试 ------------------------------------------------------


def test_login_by_code_new_user(db_session, service, mock_email):
    service._redis.get.return_value = "123456"

    input_data = LoginByCodeInput(email="code@example.com", code="123456")
    result = service.login_by_code_with_session(db_session, input_data)

    assert result.user.email == "code@example.com"
    assert result.user.email_verified_at is not None


def test_login_by_code_existing_user(db_session, service, mock_email):
    # 先注册
    service._redis.get.return_value = "123456"
    register_input = RegisterInput(email="exist@example.com", password="pass123", code="123456")
    service.register_by_email_with_session(db_session, register_input)

    # 验证码登录
    service._redis.get.return_value = "654321"
    input_data = LoginByCodeInput(email="exist@example.com", code="654321")
    result = service.login_by_code_with_session(db_session, input_data)

    assert result.user.email == "exist@example.com"


def test_login_by_code_wrong_code(db_session, service):
    service._redis.get.return_value = "123456"

    input_data = LoginByCodeInput(email="code@example.com", code="999999")

    with pytest.raises(BizException, match="验证码错误"):
        service.login_by_code_with_session(db_session, input_data)


# -- 发送验证码测试 ------------------------------------------------------


def test_send_verification_code(service, mock_email):
    service._redis.get.return_value = None  # 无冷却

    service.send_verification_code("test@example.com", "login")

    mock_email.send_verification_code.assert_called_once()
    service._redis.pipeline.assert_called_once()


def test_send_verification_code_cooldown(service, mock_email):
    service._redis.get.return_value = "1"  # 冷却中

    with pytest.raises(BizException, match="发送过于频繁"):
        service.send_verification_code("test@example.com", "login")


# -- 登出测试 ------------------------------------------------------------


def test_logout(service, mock_redis):
    # 先创建一个 refresh token
    token, jti = create_refresh_token(1, "test@example.com")

    service.logout(token)

    mock_redis.delete.assert_called_once()


def test_logout_invalid_token(service):
    with pytest.raises(BizException):
        service.logout("invalid-token")


# -- 刷新 token 测试 ----------------------------------------------------


def test_refresh_tokens(service, mock_redis):
    # 先创建一个 refresh token
    token, jti = create_refresh_token(1, "test@example.com")

    # Mock Redis 返回 user_id
    mock_redis.get.return_value = "1"

    result = service.refresh_tokens(token)

    assert result.access_token is not None
    assert result.refresh_token is not None
    assert result.user.id == 1


def test_refresh_tokens_revoked(service, mock_redis):
    token, jti = create_refresh_token(1, "test@example.com")

    # Mock Redis 返回 None（已撤销）
    mock_redis.get.return_value = None

    with pytest.raises(BizException, match="refresh token 已失效"):
        service.refresh_tokens(token)


# -- 修改密码测试 --------------------------------------------------------


def test_change_password(db_session, service, mock_email):
    # 先注册
    service._redis.get.return_value = "123456"
    register_input = RegisterInput(email="change@example.com", password="oldpass123", code="123456")
    result = service.register_by_email_with_session(db_session, register_input)

    # 修改密码
    change_input = ChangePasswordInput(old_password="oldpass123", new_password="newpass123")
    service.change_password_with_session(db_session, result.user.id, change_input)

    # 用新密码登录
    service._redis.get.return_value = "654321"
    login_input = LoginByPasswordInput(email="change@example.com", password="newpass123", code="654321")
    login_result = service.login_by_password_with_session(db_session, login_input)

    assert login_result.user.email == "change@example.com"


def test_change_password_wrong_old(db_session, service, mock_email):
    # 先注册
    service._redis.get.return_value = "123456"
    register_input = RegisterInput(email="change@example.com", password="oldpass123", code="123456")
    result = service.register_by_email_with_session(db_session, register_input)

    # 旧密码错误
    change_input = ChangePasswordInput(old_password="wrong", new_password="newpass123")

    with pytest.raises(BizException, match="旧密码错误"):
        service.change_password_with_session(db_session, result.user.id, change_input)
