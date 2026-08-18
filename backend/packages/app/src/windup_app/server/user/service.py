"""用户领域服务的 SQLAlchemy + Redis 实现。

:class:`SqlAlchemyUserService` 继承 :class:`UserService` 接口，用同步
SQLAlchemy session 落库，Redis 存储验证码与 refresh_token。

事务边界由 ``windup_framework.db.get_session`` 依赖负责——成功 commit、异常
rollback，故本实现只 ``flush``（把变更发到当前事务、取回生成的主键），不 commit。
"""

import hashlib
import logging
import secrets
import string
import uuid
from datetime import datetime, timezone

import bcrypt
import jwt
import redis as redis_lib
from sqlalchemy import select
from sqlalchemy.orm import Session

from windup_common.enums.biz_code import BizCode
from windup_common.enums.quota import CreditReason
from windup_common.exceptions import BizException
from windup_framework.config.quota import settings as quota_settings

from windup_app.server.quota.model import CreditAccount, CreditTransaction
from windup_app.server.user.interface import UserService
from windup_app.server.user.model import (
    ChangePasswordInput,
    LoginByCodeInput,
    LoginByPasswordInput,
    LoginResult,
    RegisterInput,
    ResetPasswordInput,
    UpdateNicknameInput,
    User,
    UserStatus,
    UserView,
)
from windup_framework.config.jwt import settings as jwt_settings
from windup_framework.providers.email import email_provider
from windup_framework.db.redis import get_redis

logger = logging.getLogger("windup.user.service")

# -- JWT 配置 -------------------------------------------------------------

JWT_SECRET = jwt_settings.secret.get_secret_value()
JWT_ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_SECONDS = 15 * 60  # 15 分钟
REFRESH_TOKEN_EXPIRE_SECONDS = 7 * 24 * 3600  # 7 天

# -- 密码哈希 -------------------------------------------------------------


def _hash_password(password: str) -> str:
    """bcrypt 哈希密码。"""
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def _verify_password(password: str, hashed: str) -> bool:
    """验证密码。"""
    return bcrypt.checkpw(password.encode(), hashed.encode())


# -- Redis key 前缀 -------------------------------------------------------

VERIFY_COOLDOWN_KEY = "verify:cooldown:{email}"
VERIFY_CODE_KEY = "verify:{purpose}:{email}"
REFRESH_TOKEN_KEY = "refresh:{token_hash}"
LOGIN_FAIL_KEY = "login:fail:{email}"
LOGIN_LOCK_KEY = "login:lock:{email}"

VERIFY_CODE_TTL = 300  # 5 分钟
COOLDOWN_TTL = 60  # 60 秒

LOGIN_FAIL_LIMIT = 5  # 连续错误密码上限
LOGIN_FAIL_WINDOW = 15 * 60  # 失败计数窗口 15 分钟
LOGIN_LOCK_DURATION = 15 * 60  # 锁定时长 15 分钟


def _hash_token(token: str) -> str:
    """SHA256 哈希 token，用作 Redis key。"""
    return hashlib.sha256(token.encode()).hexdigest()


def _generate_code() -> str:
    """生成 6 位数字验证码（密码学安全）。"""
    return "".join(secrets.choice(string.digits) for _ in range(6))


# -- User → UserView 转换 ------------------------------------------------


def _to_view(user: User) -> UserView:
    """ORM User → 脱敏 UserView。"""
    return UserView(
        id=user.id,
        email=user.email,
        nickname=user.nickname,
        email_verified_at=user.email_verified_at,
        status=UserStatus(user.status),
        last_login_at=user.last_login_at,
        create_at=user.create_at,
        update_at=user.update_at,
    )


# -- JWT 工具函数 ---------------------------------------------------------


def create_access_token(user_id: int, email: str) -> str:
    """签发 access_token。"""
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(user_id),
        "email": email,
        "type": "access",
        "iat": now,
        "exp": now.timestamp() + ACCESS_TOKEN_EXPIRE_SECONDS,
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def create_refresh_token(user_id: int, email: str = "") -> tuple[str, str]:
    """签发 refresh_token，返回 (token, jti)。"""
    now = datetime.now(timezone.utc)
    jti = str(uuid.uuid4())
    payload = {
        "sub": str(user_id),
        "email": email,
        "type": "refresh",
        "jti": jti,
        "iat": now,
        "exp": now.timestamp() + REFRESH_TOKEN_EXPIRE_SECONDS,
    }
    token = jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)
    return token, jti


def decode_token(token: str) -> dict:
    """解码并验证 JWT，失败抛 BizException。"""
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise BizException("token 已过期", code=BizCode.UNAUTHORIZED) from None
    except jwt.InvalidTokenError:
        raise BizException("token 无效", code=BizCode.UNAUTHORIZED) from None


# -- Service 实现 ---------------------------------------------------------


class SqlAlchemyUserService(UserService):
    """基于 SQLAlchemy session + Redis 的用户服务实现。"""

    def __init__(self) -> None:
        self._redis: redis_lib.Redis | None = None

    @property
    def redis(self) -> redis_lib.Redis:
        if self._redis is None:
            self._redis = get_redis()
        return self._redis

    # -- 注册 ------------------------------------------------------------

    def register_by_email(self, session: Session, input: RegisterInput) -> LoginResult:
        """邮箱+验证码+密码注册。邀请码选填。"""
        from windup_app.server.quota.service import (
            parse_invite_code,
            service as quota_service,
        )

        raw_invite = (input.invite_code or "").strip()
        invite_code = parse_invite_code(raw_invite) if raw_invite else None
        if invite_code is not None:
            quota_service.require_active_invite(session, invite_code)

        self._verify_code(input.email, input.code, "register")

        # 检查邮箱唯一
        existing = session.scalar(
            select(User.id).where(User.email == input.email).limit(1)
        )
        if existing is not None:
            raise BizException("邮箱已注册", code=BizCode.BAD_REQUEST)

        user = User(
            email=input.email,
            password_hash=_hash_password(input.password),
            nickname=input.nickname,
            email_verified_at=datetime.now(
                timezone.utc
            ),  # 注册即验证（已通过验证码校验）
        )
        session.add(user)
        session.flush()

        # 注册送积分；有邀请码再发双方邀请奖励
        self._create_credit_account(session, user.id)
        if invite_code is not None:
            quota_service.redeem_invite_code(session, user.id, invite_code)

        # 注册即登录，签发 token
        access_token = create_access_token(user.id, user.email)
        refresh_token, jti = create_refresh_token(user.id, user.email)
        self._store_refresh_token(jti, user.id)

        logger.info("[WINDUP] 用户注册成功 | user_id=%s email=%s", user.id, user.email)
        return LoginResult(
            user=_to_view(user),
            access_token=access_token,
            refresh_token=refresh_token,
        )

    # -- 登录限流 ----------------------------------------------------------

    def _check_login_lock(self, email: str) -> None:
        """检查账号是否因连续错误密码被锁定。"""
        lock_key = LOGIN_LOCK_KEY.format(email=email)
        if self.redis.get(lock_key):
            raise BizException("邮箱或密码错误", code=BizCode.BAD_REQUEST)

    def _record_login_failure(self, email: str) -> None:
        """记录一次错误密码，达到上限时锁定账号。"""
        fail_key = LOGIN_FAIL_KEY.format(email=email)
        count = self.redis.incr(fail_key)
        if count == 1:
            self.redis.expire(fail_key, LOGIN_FAIL_WINDOW)
        if count >= LOGIN_FAIL_LIMIT:
            lock_key = LOGIN_LOCK_KEY.format(email=email)
            self.redis.setex(lock_key, LOGIN_LOCK_DURATION, "1")

    def _clear_login_failures(self, email: str) -> None:
        """登录成功，清除失败计数和锁定。"""
        self.redis.delete(LOGIN_FAIL_KEY.format(email=email))
        self.redis.delete(LOGIN_LOCK_KEY.format(email=email))

    # -- 登录 ------------------------------------------------------------

    def login_by_password(
        self, session: Session, input: LoginByPasswordInput
    ) -> LoginResult:
        """邮箱+密码登录。"""
        # 检查账号锁定
        self._check_login_lock(input.email)

        user = session.scalar(select(User).where(User.email == input.email))
        if user is None:
            self._record_login_failure(input.email)
            raise BizException("邮箱或密码错误", code=BizCode.BAD_REQUEST)

        if not _verify_password(input.password, user.password_hash):
            self._record_login_failure(input.email)
            raise BizException("邮箱或密码错误", code=BizCode.BAD_REQUEST)

        if user.status == UserStatus.BANNED:
            raise BizException("账号已被封禁", code=BizCode.BAD_REQUEST)

        # 登录成功，清除失败计数
        self._clear_login_failures(input.email)

        # 更新最后登录时间
        user.last_login_at = datetime.now(timezone.utc)
        session.flush()

        access_token = create_access_token(user.id, user.email)
        refresh_token, jti = create_refresh_token(user.id, user.email)
        self._store_refresh_token(jti, user.id)

        logger.info("[WINDUP] 用户登录成功 | user_id=%s email=%s", user.id, user.email)
        return LoginResult(
            user=_to_view(user),
            access_token=access_token,
            refresh_token=refresh_token,
        )

    # -- 验证码 ----------------------------------------------------------

    def send_verification_code(self, email: str, purpose: str) -> None:
        """发送邮箱验证码。"""
        # 频率限制
        cooldown_key = VERIFY_COOLDOWN_KEY.format(email=email)
        if self.redis.get(cooldown_key):
            raise BizException(
                "发送过于频繁，请稍后再试", code=BizCode.TOO_MANY_REQUESTS
            )

        code = _generate_code()
        code_key = VERIFY_CODE_KEY.format(purpose=purpose, email=email)

        # 存储验证码 + 设置冷却
        pipe = self.redis.pipeline()
        pipe.setex(code_key, VERIFY_CODE_TTL, code)
        pipe.setex(cooldown_key, COOLDOWN_TTL, "1")
        pipe.execute()

        # 发送邮件
        email_provider.send_verification_code(email, code)
        logger.info("[WINDUP] 验证码已发送 | email=%s purpose=%s", email, purpose)

    def _verify_code(self, email: str, code: str, purpose: str) -> None:
        """校验验证码，失败抛 BizException。"""
        code_key = VERIFY_CODE_KEY.format(purpose=purpose, email=email)
        stored_code = self.redis.get(code_key)
        if stored_code is None:
            raise BizException("验证码已过期", code=BizCode.BAD_REQUEST)
        if stored_code != code:
            raise BizException("验证码错误", code=BizCode.BAD_REQUEST)
        # 验证通过，删除验证码
        self.redis.delete(code_key)

    def login_by_code(self, session: Session, input: LoginByCodeInput) -> LoginResult:
        """邮箱+验证码登录。未知邮箱自动建号并赠送注册积分。"""
        # 校验验证码
        self._verify_code(input.email, input.code, "login")

        user = session.scalar(select(User).where(User.email == input.email))
        if user is None:
            user = User(
                email=input.email,
                password_hash="",
                email_verified_at=datetime.now(timezone.utc),
            )
            session.add(user)
            session.flush()
            self._create_credit_account(session, user.id)
        else:
            if user.status == UserStatus.BANNED:
                raise BizException("账号已被封禁", code=BizCode.BAD_REQUEST)
            if user.email_verified_at is None:
                user.email_verified_at = datetime.now(timezone.utc)

        user.last_login_at = datetime.now(timezone.utc)
        session.flush()

        access_token = create_access_token(user.id, user.email)
        refresh_token, jti = create_refresh_token(user.id, user.email)
        self._store_refresh_token(jti, user.id)

        return LoginResult(
            user=_to_view(user),
            access_token=access_token,
            refresh_token=refresh_token,
        )

    # -- 登出 ------------------------------------------------------------

    def logout(self, refresh_token: str) -> None:
        """撤销 refresh_token。"""
        payload = decode_token(refresh_token)
        if payload.get("type") != "refresh":
            raise BizException("token 类型错误", code=BizCode.UNAUTHORIZED)

        jti = payload.get("jti")
        if jti:
            token_hash = _hash_token(jti)
            self.redis.delete(REFRESH_TOKEN_KEY.format(token_hash=token_hash))

        logger.info("[WINDUP] 用户登出 | user_id=%s", payload.get("sub"))

    # -- Token 验证 ------------------------------------------------------

    def validate_access_token(self, token: str) -> UserView | None:
        """校验 access_token，返回 UserView 或 None。"""
        try:
            payload = decode_token(token)
        except BizException:
            return None

        if payload.get("type") != "access":
            return None

        return UserView(
            id=int(payload["sub"]),
            email=payload.get("email", ""),
        )

    # -- Lua: 原子 检查-删除-存储 refresh token --------------------------------
    # KEYS[1] = old_token_key, KEYS[2] = new_token_key
    # ARGV[1] = ttl, ARGV[2] = user_id
    # 返回: user_id (成功) 或 nil (旧 token 不存在/已被消费)
    _ROTATE_TOKEN_SCRIPT = """
    local old_key = KEYS[1]
    local new_key = KEYS[2]
    local ttl     = tonumber(ARGV[1])
    local user_id = ARGV[2]
    local cur = redis.call('GET', old_key)
    if cur == false then
        return nil
    end
    redis.call('DEL', old_key)
    redis.call('SETEX', new_key, ttl, user_id)
    return cur
    """

    def refresh_tokens(self, refresh_token: str) -> LoginResult:
        """刷新 token。"""
        payload = decode_token(refresh_token)
        if payload.get("type") != "refresh":
            raise BizException("token 类型错误", code=BizCode.UNAUTHORIZED)

        jti = payload.get("jti")
        if not jti:
            raise BizException("token 无效", code=BizCode.UNAUTHORIZED)

        # user_id 来自已验签的 JWT，可信
        user_id = int(payload["sub"])
        email = payload.get("email", "")

        # 签发新 token
        new_access = create_access_token(user_id, email)
        new_refresh, new_jti = create_refresh_token(user_id, email)

        # Lua 原子操作：GET old → 存在则 DEL old + SETEX new → 返回 user_id
        token_hash = _hash_token(jti)
        old_redis_key = REFRESH_TOKEN_KEY.format(token_hash=token_hash)
        new_token_hash = _hash_token(new_jti)
        new_redis_key = REFRESH_TOKEN_KEY.format(token_hash=new_token_hash)

        user_id_str = self.redis.eval(
            self._ROTATE_TOKEN_SCRIPT,
            2,
            old_redis_key,
            new_redis_key,
            REFRESH_TOKEN_EXPIRE_SECONDS,
            str(user_id),
        )

        if user_id_str is None:
            raise BizException("refresh token 已失效", code=BizCode.UNAUTHORIZED)

        logger.info("[WINDUP] token 已刷新 | user_id=%s", user_id)
        return LoginResult(
            user=UserView(id=user_id, email=email),
            access_token=new_access,
            refresh_token=new_refresh,
        )

    # -- 密码 ------------------------------------------------------------

    def change_password(
        self, session: Session, user_id: int, input: ChangePasswordInput
    ) -> None:
        """修改密码。"""
        user = session.get(User, user_id)
        if user is None:
            raise BizException("用户不存在", code=BizCode.NOT_FOUND)

        if not _verify_password(input.old_password, user.password_hash):
            raise BizException("旧密码错误", code=BizCode.BAD_REQUEST)

        user.password_hash = _hash_password(input.new_password)
        session.flush()

        # 修改密码后撤销该用户所有 refresh_token
        self._revoke_all_user_tokens(user_id)
        logger.info("[WINDUP] 密码已修改 | user_id=%s", user_id)

    def reset_password(self, session: Session, input: ResetPasswordInput) -> None:
        """邮箱+验证码重置密码（忘记密码场景）。"""
        # 校验验证码（purpose 必须为 reset_password）
        self._verify_code(input.email, input.code, "reset_password")

        user = session.scalar(select(User).where(User.email == input.email))
        if user is None:
            raise BizException("用户不存在", code=BizCode.NOT_FOUND)

        if user.status == UserStatus.BANNED:
            raise BizException("账号已被封禁", code=BizCode.BAD_REQUEST)

        user.password_hash = _hash_password(input.new_password)
        session.flush()

        # 重置密码后撤销该用户所有 refresh_token
        self._revoke_all_user_tokens(user.id)
        logger.info("[WINDUP] 密码已重置 | user_id=%s email=%s", user.id, user.email)

    # -- 昵称 ------------------------------------------------------------

    def update_nickname(
        self, session: Session, user_id: int, input: UpdateNicknameInput
    ) -> UserView:
        """修改昵称。"""
        user = session.get(User, user_id)
        if user is None:
            raise BizException("用户不存在", code=BizCode.NOT_FOUND)

        user.nickname = input.nickname
        session.flush()

        logger.info("[WINDUP] 昵称已修改 | user_id=%s", user_id)
        return _to_view(user)

    # -- 查询 ------------------------------------------------------------

    def get_by_id(self, session: Session, user_id: int) -> UserView | None:
        user = session.get(User, user_id)
        return _to_view(user) if user else None

    def get_by_email(self, session: Session, email: str) -> UserView | None:
        user = session.scalar(select(User).where(User.email == email))
        return _to_view(user) if user else None

    # -- 内部方法 --------------------------------------------------------

    def _create_credit_account(self, session: Session, user_id: int) -> None:
        """注册时创建积分账户并赠送初始积分。"""
        account = CreditAccount(
            user_id=user_id,
            balance=quota_settings.register_gift_amount,
            frozen=0,
            total_earned=quota_settings.register_gift_amount,
            total_spent=0,
        )
        session.add(account)
        session.flush()

        txn = CreditTransaction(
            user_id=user_id,
            delta=quota_settings.register_gift_amount,
            reason=CreditReason.REGISTER_GIFT,
            billing_mode=0,  # PREPAID
            ref_id=f"register:{user_id}",
            balance_after=quota_settings.register_gift_amount,
        )
        session.add(txn)
        session.flush()

        logger.info(
            "[WINDUP] 注册送积分 | user_id=%s amount=%s",
            user_id,
            quota_settings.register_gift_amount,
        )

    def _store_refresh_token(self, jti: str, user_id: int) -> None:
        """将 refresh_token 存入 Redis。"""
        token_hash = _hash_token(jti)
        self.redis.setex(
            REFRESH_TOKEN_KEY.format(token_hash=token_hash),
            REFRESH_TOKEN_EXPIRE_SECONDS,
            str(user_id),
        )

    def _revoke_all_user_tokens(self, user_id: int) -> None:
        """撤销指定用户的所有 refresh_token（改密时调用）。

        注意：Redis SCAN 在 key 数量大时有性能开销，当前阶段用户量小可接受。
        后续可维护 user_id → token_hash 的反向索引优化。
        """
        pattern = "refresh:*"
        for key in self.redis.scan_iter(match=pattern, count=100):
            if self.redis.get(key) == str(user_id):
                self.redis.delete(key)


service = SqlAlchemyUserService()
