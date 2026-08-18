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
    ResetPasswordInput,
    UpdateNicknameInput,
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


@pytest.fixture(autouse=True)
def _seed_invite(request):
    if "db_session" in request.fixturenames:
        request.getfixturevalue("invite_code")


@pytest.fixture()
def mock_redis():
    """Mock Redis 客户端。"""
    redis_mock = MagicMock()
    redis_mock.get.return_value = None
    redis_mock.setex.return_value = True
    redis_mock.delete.return_value = True
    redis_mock.eval.return_value = None  # Lua 脚本默认返回 None
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
        invite_code="AB23CD45",
    )

    result = service.register_by_email(db_session, input_data)

    assert result.user.email == "new@example.com"
    assert result.access_token is not None
    assert result.refresh_token is not None
    assert result.user.email_verified_at is not None  # 注册即验证


def test_public_methods_accept_session(db_session, service, mock_email):
    """公开接口走 session-per-call，不再抛 NotImplementedError。"""
    service._redis.get.return_value = "123456"
    registered = service.register_by_email(
        db_session,
        RegisterInput(
            email="public@example.com",
            password="password123",
            code="123456",
            invite_code="AB23CD45",
        ),
    )

    by_id = service.get_by_id(db_session, registered.user.id)
    by_email = service.get_by_email(db_session, "public@example.com")
    assert by_id is not None
    assert by_email is not None
    assert by_id.email == by_email.email == "public@example.com"

    service._redis.get.return_value = None  # 未锁定
    login = service.login_by_password(
        db_session,
        LoginByPasswordInput(email="public@example.com", password="password123"),
    )
    assert login.user.id == registered.user.id

    service.change_password(
        db_session,
        registered.user.id,
        ChangePasswordInput(old_password="password123", new_password="newpass123"),
    )

    service._redis.get.return_value = "654321"
    code_login = service.login_by_code(
        db_session,
        LoginByCodeInput(email="public@example.com", code="654321"),
    )
    assert code_login.user.id == registered.user.id


def test_register_creates_credit_account(db_session, service, mock_email):
    """注册时应自动创建积分账户并赠送初始积分。"""
    from sqlalchemy import select
    from windup_app.server.quota.model import CreditAccount, CreditTransaction
    from windup_common.enums.quota import CreditReason
    from windup_framework.config.quota import settings as quota_settings

    service._redis.get.return_value = "123456"

    input_data = RegisterInput(
        email="credit@example.com",
        password="password123",
        code="123456",
        invite_code="AB23CD45",
    )

    result = service.register_by_email(db_session, input_data)
    user_id = result.user.id
    expected = quota_settings.register_gift_amount + quota_settings.invite_reward_amount

    # 验证积分账户已创建
    account = db_session.scalar(
        select(CreditAccount).where(CreditAccount.user_id == user_id)
    )
    assert account is not None
    assert account.balance == expected
    assert account.frozen == 0
    assert account.total_earned == expected
    assert account.total_spent == 0

    # 验证赠送流水已记录
    txn = db_session.scalar(
        select(CreditTransaction).where(
            CreditTransaction.user_id == user_id,
            CreditTransaction.reason == CreditReason.REGISTER_GIFT,
        )
    )
    assert txn is not None
    assert txn.delta == quota_settings.register_gift_amount
    assert txn.ref_id == f"register:{user_id}"
    assert txn.balance_after == quota_settings.register_gift_amount


def test_register_duplicate_email(db_session, service):
    # 先注册一个用户
    service._redis.get.return_value = "123456"
    input_data = RegisterInput(
        email="dup@example.com",
        password="pass123",
        code="123456",
        invite_code="AB23CD45",
    )
    service.register_by_email(db_session, input_data)

    # 尝试重复注册
    with pytest.raises(BizException, match="邮箱已注册"):
        service.register_by_email(db_session, input_data)


def test_register_wrong_code(db_session, service):
    service._redis.get.return_value = "123456"

    input_data = RegisterInput(
        email="new@example.com",
        password="password123",
        code="999999",  # 错误验证码
        invite_code="AB23CD45",
    )

    with pytest.raises(BizException, match="验证码错误"):
        service.register_by_email(db_session, input_data)


def test_register_expired_code(db_session, service):
    service._redis.get.return_value = None  # 验证码已过期

    input_data = RegisterInput(
        email="new@example.com",
        password="password123",
        code="123456",
        invite_code="AB23CD45",
    )

    with pytest.raises(BizException, match="验证码已过期"):
        service.register_by_email(db_session, input_data)


def test_register_blank_invite_code_only_gives_register_gift(db_session, service):
    """未带邀请码时只发注册赠送，不挡注册。"""
    from sqlalchemy import select
    from windup_app.server.quota.model import CreditAccount
    from windup_framework.config.quota import settings as quota_settings

    service._redis.get.return_value = "123456"
    input_data = RegisterInput(
        email="blank-invite@example.com",
        password="password123",
        code="123456",
        invite_code="   ",
    )

    result = service.register_by_email(db_session, input_data)
    account = db_session.scalar(
        select(CreditAccount).where(CreditAccount.user_id == result.user.id)
    )
    assert account is not None
    assert account.balance == quota_settings.register_gift_amount


def test_register_rejects_invite_code_outside_link_charset(db_session, service):
    """前端邀请链接用 A-H/J-N/P-Z/2-9，含 I/O/0/1 的码不会进注册请求。"""
    service._redis.get.return_value = "123456"
    input_data = RegisterInput(
        email="bad-charset@example.com",
        password="password123",
        code="123456",
        invite_code="IIII",
    )

    with pytest.raises(BizException, match="邀请码无效"):
        service.register_by_email(db_session, input_data)


def test_register_expired_invite_code(db_session, service):
    from datetime import datetime, timedelta, timezone
    from sqlalchemy import select
    from windup_app.server.quota.model import InviteCode
    from windup_common.enums.biz_code import BizCode

    row = db_session.scalar(select(InviteCode).where(InviteCode.code == "AB23CD45"))
    row.expires_at = datetime.now(timezone.utc) - timedelta(days=1)
    db_session.flush()

    service._redis.get.return_value = "123456"
    input_data = RegisterInput(
        email="late@example.com",
        password="password123",
        code="123456",
        invite_code="AB23CD45",
    )
    with pytest.raises(BizException, match="邀请码已过期") as exc:
        service.register_by_email(db_session, input_data)
    assert exc.value.code == BizCode.NOT_FOUND
    assert db_session.scalar(select(User).where(User.email == "late@example.com")) is None


# -- 登录测试 ------------------------------------------------------------


def test_login_success(db_session, service, mock_email):
    # 先注册
    service._redis.get.return_value = "123456"
    register_input = RegisterInput(
        email="login@example.com",
        password="pass123",
        code="123456",
        invite_code="AB23CD45",
    )
    service.register_by_email(db_session, register_input)

    # 登录（不需要验证码）
    service._redis.get.return_value = None  # 未锁定
    login_input = LoginByPasswordInput(email="login@example.com", password="pass123")
    result = service.login_by_password(db_session, login_input)

    assert result.user.email == "login@example.com"
    assert result.access_token is not None


def test_login_wrong_password(db_session, service, mock_email):
    # 先注册
    service._redis.get.return_value = "123456"
    register_input = RegisterInput(
        email="login@example.com",
        password="pass123",
        code="123456",
        invite_code="AB23CD45",
    )
    service.register_by_email(db_session, register_input)

    # 密码错误
    service._redis.get.return_value = None  # 未锁定
    service._redis.incr.return_value = 1
    login_input = LoginByPasswordInput(email="login@example.com", password="wrong")

    with pytest.raises(BizException, match="邮箱或密码错误"):
        service.login_by_password(db_session, login_input)


def test_login_nonexistent_user(db_session, service):
    service._redis.get.return_value = None  # 未锁定
    service._redis.incr.return_value = 1
    login_input = LoginByPasswordInput(email="no@example.com", password="pass123")

    with pytest.raises(BizException, match="邮箱或密码错误"):
        service.login_by_password(db_session, login_input)


def test_login_banned_user(db_session, service, mock_email):
    # 先注册
    service._redis.get.return_value = "123456"
    register_input = RegisterInput(
        email="banned@example.com",
        password="pass123",
        code="123456",
        invite_code="AB23CD45",
    )
    service.register_by_email(db_session, register_input)

    # 封禁用户
    from sqlalchemy import select

    user = db_session.scalar(select(User).where(User.email == "banned@example.com"))
    user.status = UserStatus.BANNED
    db_session.flush()

    # 尝试登录
    service._redis.get.return_value = None  # 未锁定
    login_input = LoginByPasswordInput(email="banned@example.com", password="pass123")

    with pytest.raises(BizException, match="账号已被封禁"):
        service.login_by_password(db_session, login_input)


# -- 验证码登录测试 ------------------------------------------------------


def test_login_by_code_unknown_email_creates_user_and_gifts(
    db_session, service, mock_email
):
    """未知邮箱验证码登录自动建号，并只发注册赠送。"""
    from sqlalchemy import select
    from windup_app.server.quota.model import CreditAccount
    from windup_framework.config.quota import settings as quota_settings

    service._redis.get.return_value = "123456"
    input_data = LoginByCodeInput(email="code@example.com", code="123456")

    result = service.login_by_code(db_session, input_data)

    user = db_session.scalar(select(User).where(User.email == "code@example.com"))
    assert user is not None
    assert result.user.id == user.id
    assert result.user.email_verified_at is not None
    account = db_session.scalar(
        select(CreditAccount).where(CreditAccount.user_id == user.id)
    )
    assert account is not None
    assert account.balance == quota_settings.register_gift_amount


def test_send_verification_code_allows_register_purpose(service, mock_email):
    service._redis.get.return_value = None

    service.send_verification_code("new@example.com", "register")

    mock_email.send_verification_code.assert_called_once()


def test_login_by_code_banned_user(db_session, service, mock_email):
    from sqlalchemy import select

    service._redis.get.return_value = "123456"
    service.register_by_email(
        db_session,
        RegisterInput(
            email="banned-code@example.com",
            password="pass123",
            code="123456",
            invite_code="AB23CD45",
        ),
    )
    user = db_session.scalar(
        select(User).where(User.email == "banned-code@example.com")
    )
    user.status = UserStatus.BANNED
    db_session.flush()

    service._redis.get.return_value = "654321"
    with pytest.raises(BizException, match="账号已被封禁"):
        service.login_by_code(
            db_session,
            LoginByCodeInput(email="banned-code@example.com", code="654321"),
        )


def test_login_by_code_marks_unverified_email(db_session, service):
    user = User(email="unverified@example.com", password_hash=_hash_password("pass123"))
    db_session.add(user)
    db_session.flush()

    service._redis.get.return_value = "123456"
    result = service.login_by_code(
        db_session,
        LoginByCodeInput(email="unverified@example.com", code="123456"),
    )

    assert result.user.email == "unverified@example.com"
    assert result.user.email_verified_at is not None


def test_login_by_code_existing_user(db_session, service, mock_email):
    # 先注册
    service._redis.get.return_value = "123456"
    register_input = RegisterInput(
        email="exist@example.com",
        password="pass123",
        code="123456",
        invite_code="AB23CD45",
    )
    service.register_by_email(db_session, register_input)

    # 验证码登录
    service._redis.get.return_value = "654321"
    input_data = LoginByCodeInput(email="exist@example.com", code="654321")
    result = service.login_by_code(db_session, input_data)

    assert result.user.email == "exist@example.com"


def test_login_by_code_wrong_code(db_session, service):
    service._redis.get.return_value = "123456"

    input_data = LoginByCodeInput(email="code@example.com", code="999999")

    with pytest.raises(BizException, match="验证码错误"):
        service.login_by_code(db_session, input_data)


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

    # Mock Redis eval 返回 user_id（Lua 脚本成功）
    mock_redis.eval.return_value = "1"

    result = service.refresh_tokens(token)

    assert result.access_token is not None
    assert result.refresh_token is not None
    assert result.user.id == 1
    # 验证调用了 eval（Lua 脚本），而不是 get
    mock_redis.eval.assert_called_once()


def test_refresh_tokens_revoked(service, mock_redis):
    token, jti = create_refresh_token(1, "test@example.com")

    # Mock Redis eval 返回 None（Lua 脚本：旧 token 不存在）
    mock_redis.eval.return_value = None

    with pytest.raises(BizException, match="refresh token 已失效"):
        service.refresh_tokens(token)


def test_refresh_tokens_concurrent_reuse(service, mock_redis):
    """并发重放：同一个 refresh token 第二次调用应失败。"""
    token, jti = create_refresh_token(1, "test@example.com")

    # 第一次调用成功
    mock_redis.eval.return_value = "1"
    result1 = service.refresh_tokens(token)
    assert result1.access_token is not None

    # 第二次调用（并发重放）失败
    mock_redis.eval.return_value = None
    with pytest.raises(BizException, match="refresh token 已失效"):
        service.refresh_tokens(token)


# -- 修改密码测试 --------------------------------------------------------


def test_change_password(db_session, service, mock_email):
    # 先注册
    service._redis.get.return_value = "123456"
    register_input = RegisterInput(
        email="change@example.com",
        password="oldpass123",
        code="123456",
        invite_code="AB23CD45",
    )
    result = service.register_by_email(db_session, register_input)

    # 修改密码
    change_input = ChangePasswordInput(
        old_password="oldpass123", new_password="newpass123"
    )
    service.change_password(db_session, result.user.id, change_input)

    # 用新密码登录
    service._redis.get.return_value = None
    login_input = LoginByPasswordInput(
        email="change@example.com", password="newpass123"
    )
    login_result = service.login_by_password(db_session, login_input)

    assert login_result.user.email == "change@example.com"


def test_change_password_wrong_old(db_session, service, mock_email):
    # 先注册
    service._redis.get.return_value = "123456"
    register_input = RegisterInput(
        email="change@example.com",
        password="oldpass123",
        code="123456",
        invite_code="AB23CD45",
    )
    result = service.register_by_email(db_session, register_input)

    # 旧密码错误
    change_input = ChangePasswordInput(old_password="wrong", new_password="newpass123")

    with pytest.raises(BizException, match="旧密码错误"):
        service.change_password(db_session, result.user.id, change_input)


# -- 昵称修改测试 --------------------------------------------------------


def test_update_nickname(db_session, service, mock_email):
    """修改昵称后立即生效。"""
    service._redis.get.return_value = "123456"
    register_input = RegisterInput(
        email="nick@example.com",
        password="pass1234",
        code="123456",
        nickname="旧昵称",
        invite_code="AB23CD45",
    )
    result = service.register_by_email(db_session, register_input)

    update_input = UpdateNicknameInput(nickname="新昵称")
    user_view = service.update_nickname(db_session, result.user.id, update_input)

    assert user_view.nickname == "新昵称"
    assert user_view.id == result.user.id


def test_update_nickname_max_length(db_session, service, mock_email):
    """昵称长度上限 50。"""
    service._redis.get.return_value = "123456"
    register_input = RegisterInput(
        email="nick2@example.com",
        password="pass1234",
        code="123456",
        invite_code="AB23CD45",
    )
    result = service.register_by_email(db_session, register_input)

    long_nickname = "a" * 50
    update_input = UpdateNicknameInput(nickname=long_nickname)
    user_view = service.update_nickname(db_session, result.user.id, update_input)

    assert user_view.nickname == long_nickname


def test_update_nickname_user_not_found(db_session, service):
    """用户不存在时抛异常。"""
    update_input = UpdateNicknameInput(nickname="test")

    with pytest.raises(BizException, match="用户不存在"):
        service.update_nickname(db_session, 999999, update_input)


# -- 重置密码测试 --------------------------------------------------------


def test_reset_password(db_session, service, mock_email):
    """邮箱+验证码重置密码后，新密码可登录。"""
    # 先注册
    service._redis.get.return_value = "123456"
    register_input = RegisterInput(
        email="reset@example.com",
        password="oldpass123",
        code="123456",
        invite_code="AB23CD45",
    )
    service.register_by_email(db_session, register_input)

    # 重置密码（验证码 purpose 为 reset_password）
    service._redis.get.return_value = "654321"
    reset_input = ResetPasswordInput(
        email="reset@example.com", code="654321", new_password="newpass123"
    )
    service.reset_password(db_session, reset_input)

    # 用新密码登录
    service._redis.get.return_value = None
    login_input = LoginByPasswordInput(email="reset@example.com", password="newpass123")
    login_result = service.login_by_password(db_session, login_input)

    assert login_result.user.email == "reset@example.com"


def test_reset_password_wrong_code(db_session, service, mock_email):
    """验证码错误时拒绝重置。"""
    service._redis.get.return_value = "123456"
    register_input = RegisterInput(
        email="reset2@example.com",
        password="oldpass123",
        code="123456",
        invite_code="AB23CD45",
    )
    service.register_by_email(db_session, register_input)

    # 验证码错误
    service._redis.get.return_value = None  # 验证码过期
    reset_input = ResetPasswordInput(
        email="reset2@example.com", code="000000", new_password="newpass123"
    )

    with pytest.raises(BizException, match="验证码已过期"):
        service.reset_password(db_session, reset_input)


def test_reset_password_user_not_found(db_session, service):
    """用户不存在时拒绝重置。"""
    service._redis.get.return_value = "654321"
    reset_input = ResetPasswordInput(
        email="noexist@example.com", code="654321", new_password="newpass123"
    )

    with pytest.raises(BizException, match="用户不存在"):
        service.reset_password(db_session, reset_input)


# -- 登录限流测试 --------------------------------------------------------


def test_login_account_locked(db_session, service, mock_email):
    """账号被锁定后拒绝登录（即使密码正确）。"""
    # 先注册
    service._redis.get.return_value = "123456"
    register_input = RegisterInput(
        email="lock@example.com",
        password="pass123",
        code="123456",
        invite_code="AB23CD45",
    )
    service.register_by_email(db_session, register_input)

    # 模拟账号锁定
    service._redis.get.return_value = "1"  # lock key 存在
    login_input = LoginByPasswordInput(email="lock@example.com", password="pass123")

    with pytest.raises(BizException, match="邮箱或密码错误"):
        service.login_by_password(db_session, login_input)


def test_login_failure_records_count(service, mock_redis):
    """错误密码时调用 redis.incr 记录失败次数。"""
    mock_redis.get.return_value = None  # 未锁定
    mock_redis.incr.return_value = 1

    service._record_login_failure("test@example.com")

    mock_redis.incr.assert_called_once()
    mock_redis.expire.assert_called_once()


def test_login_failure_triggers_lock(service, mock_redis):
    """连续失败达到上限时触发锁定。"""
    mock_redis.incr.return_value = 5  # 第5次失败

    service._record_login_failure("test@example.com")

    # 验证设置了 lock key
    mock_redis.setex.assert_called_once()
    args = mock_redis.setex.call_args[0]
    assert "login:lock:" in args[0]


def test_login_success_clears_failures(service, mock_redis):
    """登录成功后清除失败计数和锁定。"""
    service._clear_login_failures("test@example.com")

    # 验证删除了 fail key 和 lock key
    assert mock_redis.delete.call_count == 2
