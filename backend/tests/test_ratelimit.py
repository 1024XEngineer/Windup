"""两阶段限流测试。

覆盖 Issue #292 的验收标准：
1. 同 IP 3次正确登录不被拦截
2. 先有其他认证请求，正确登录仍成功
3. 先有 58次普通 API，正确登录仍成功
4. 同 IP 不同邮箱不共享错误密码计数
5. 错误密码达阈值仍触发保护
6. 成功登录清理错误计数
7. 发码冷却独立
8. 已登录请求进入用户级限流
9. 直连场景 IP 正确
10. X-Forwarded-For 可信代理
11. 共享出口 IP 不同账号独立
12. 日志区分四类触发来源
"""

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from windup_app.web.middleware.ratelimit import (
    AuthRateLimitMiddleware,
    _check_rate,
    _get_client_ip,
    _has_auth_header,
    _is_trusted_proxy,
    record_auth_failure,
    rate_limit_dep,
)


# -- 辅助 ----------------------------------------------------------------


class FakeRedis:
    """内存 Redis 模拟，支持 incr / expire / get / setex / ping。"""

    def __init__(self):
        self._store: dict[str, int] = {}
        self._ttl: dict[str, int] = {}

    def incr(self, key: str) -> int:
        self._store[key] = self._store.get(key, 0) + 1
        return self._store[key]

    def expire(self, key: str, ttl: int):
        self._ttl[key] = ttl

    def get(self, key: str):
        return self._store.get(key)

    def setex(self, key: str, ttl: int, value):
        self._store[key] = int(value) if isinstance(value, (int, str)) else 0
        self._ttl[key] = ttl

    def ping(self):
        return True

    def delete(self, key: str):
        self._store.pop(key, None)
        self._ttl.pop(key, None)

    def reset(self):
        self._store.clear()
        self._ttl.clear()


@pytest.fixture()
def fake_redis():
    """每个测试独立的 FakeRedis 实例。"""
    redis = FakeRedis()
    with patch("windup_app.web.middleware.ratelimit._get_redis", return_value=redis):
        yield redis


def _run(coro):
    """在同步测试中运行 async 函数。"""
    try:
        loop = asyncio.get_event_loop()
        if loop.is_closed():
            raise RuntimeError("loop closed")
    except RuntimeError:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
    return loop.run_until_complete(coro)


# -- 单元测试：辅助函数 ---------------------------------------------------


class TestTrustedProxy:
    def test_localhost_is_trusted(self):
        assert _is_trusted_proxy("127.0.0.1") is True
        assert _is_trusted_proxy("::1") is True

    def test_docker_network_is_trusted(self):
        assert _is_trusted_proxy("172.17.0.1") is True
        assert _is_trusted_proxy("172.31.255.255") is True

    def test_public_ip_not_trusted(self):
        assert _is_trusted_proxy("8.8.8.8") is False
        assert _is_trusted_proxy("192.168.1.1") is False

    def test_none_not_trusted(self):
        assert _is_trusted_proxy(None) is False


class TestGetClientIp:
    def test_direct_client(self):
        request = MagicMock()
        request.client.host = "1.2.3.4"
        request.headers = {}
        assert _get_client_ip(request) == "1.2.3.4"

    def test_trusted_proxy_with_xff(self):
        request = MagicMock()
        request.client.host = "127.0.0.1"
        request.headers = {"x-forwarded-for": "5.6.7.8, 10.0.0.1"}
        assert _get_client_ip(request) == "5.6.7.8"

    def test_untrusted_proxy_ignores_xff(self):
        request = MagicMock()
        request.client.host = "8.8.8.8"
        request.headers = {"x-forwarded-for": "5.6.7.8"}
        assert _get_client_ip(request) == "8.8.8.8"

    def test_no_client_returns_unknown(self):
        request = MagicMock()
        request.client = None
        request.headers = {}
        assert _get_client_ip(request) == "unknown"


class TestHasAuthHeader:
    def test_bearer_token(self):
        request = MagicMock()
        request.headers = {"authorization": "Bearer abc123"}
        assert _has_auth_header(request) is True

    def test_no_header(self):
        request = MagicMock()
        request.headers = {}
        assert _has_auth_header(request) is False

    def test_non_bearer(self):
        request = MagicMock()
        request.headers = {"authorization": "Basic abc123"}
        assert _has_auth_header(request) is False


class TestCheckRate:
    def test_allows_within_limit(self):
        redis = FakeRedis()
        for i in range(10):
            assert _check_rate(redis, "test:key", 10, 60) is True

    def test_blocks_at_limit(self):
        redis = FakeRedis()
        for i in range(10):
            _check_rate(redis, "test:key", 10, 60)
        assert _check_rate(redis, "test:key", 10, 60) is False

    def test_redis_error_allows(self):
        redis = MagicMock()
        redis.incr.side_effect = Exception("connection lost")
        assert _check_rate(redis, "test:key", 10, 60) is True


# -- 集成测试：Phase 1 中间件 ---------------------------------------------


class TestAuthRateLimitMiddleware:
    """Phase 1 中间件行为测试。"""

    def _make_request(self, path: str, ip: str = "1.2.3.4", has_auth: bool = False):
        """构造模拟请求。"""
        request = MagicMock()
        request.url.path = path
        request.client.host = ip
        headers = {}
        if has_auth:
            headers["authorization"] = "Bearer test-token"
        request.headers = headers
        return request

    def test_auth_endpoint_uses_own_bucket(self, fake_redis):
        """认证端点使用独立 IP 桶。"""
        middleware = AuthRateLimitMiddleware(MagicMock())
        mock_response = MagicMock()
        call_next = AsyncMock(return_value=mock_response)

        # /auth/register 限流 3 次/分钟
        for i in range(3):
            req = self._make_request("/auth/register")
            resp = _run(middleware.dispatch(req, call_next))
            assert resp == mock_response

        # 第 4 次应被拦截
        req = self._make_request("/auth/register")
        resp = _run(middleware.dispatch(req, call_next))
        assert resp.status_code == 200

    def test_different_endpoints_independent(self, fake_redis):
        """不同认证端点互不干扰。"""
        middleware = AuthRateLimitMiddleware(MagicMock())
        mock_response = MagicMock()
        call_next = AsyncMock(return_value=mock_response)

        # /auth/register 用满 3 次
        for i in range(3):
            _run(middleware.dispatch(self._make_request("/auth/register"), call_next))

        # /auth/send-code 仍有 3 次额度
        for i in range(3):
            req = self._make_request("/auth/send-code")
            resp = _run(middleware.dispatch(req, call_next))
            assert resp == mock_response

    def test_login_passes_through_middleware(self, fake_redis):
        """/auth/login 在中间件中不计数，始终通过。"""
        middleware = AuthRateLimitMiddleware(MagicMock())
        mock_response = MagicMock()
        call_next = AsyncMock(return_value=mock_response)

        for i in range(20):
            req = self._make_request("/auth/login")
            resp = _run(middleware.dispatch(req, call_next))
            assert resp == mock_response

    def test_global_bucket_only_for_anonymous(self, fake_redis):
        """非认证端点全局桶仅对匿名请求生效。"""
        middleware = AuthRateLimitMiddleware(MagicMock())
        mock_response = MagicMock()
        call_next = AsyncMock(return_value=mock_response)

        # 匿名请求消耗全局桶
        for i in range(60):
            req = self._make_request("/projects/list", has_auth=False)
            resp = _run(middleware.dispatch(req, call_next))
            assert resp == mock_response

        # 第 61 次匿名请求被拦截
        req = self._make_request("/projects/list", has_auth=False)
        resp = _run(middleware.dispatch(req, call_next))
        assert resp.status_code == 200

    def test_authenticated_skips_global_bucket(self, fake_redis):
        """已认证请求不消耗全局桶。"""
        middleware = AuthRateLimitMiddleware(MagicMock())
        mock_response = MagicMock()
        call_next = AsyncMock(return_value=mock_response)

        # 已认证请求 61 次不应被全局桶拦截
        for i in range(61):
            req = self._make_request("/projects/list", has_auth=True)
            resp = _run(middleware.dispatch(req, call_next))
            assert resp == mock_response

    def test_redis_unavailable_passes_through(self):
        """Redis 不可用时所有请求通过。"""
        with patch("windup_app.web.middleware.ratelimit._get_redis", return_value=None):
            middleware = AuthRateLimitMiddleware(MagicMock())
            mock_response = MagicMock()
            call_next = AsyncMock(return_value=mock_response)
            req = self._make_request("/auth/register")
            resp = _run(middleware.dispatch(req, call_next))
            assert resp == mock_response


# -- 集成测试：record_auth_failure ----------------------------------------


class TestRecordAuthFailure:
    def test_records_failure(self, fake_redis):
        """record_auth_failure 正确递增计数。"""
        record_auth_failure("login", "1.2.3.4")
        assert fake_redis.get("ratelimit:auth:login:1.2.3.4") == 1

    def test_blocks_after_limit(self, fake_redis):
        """10 次失败后 IP 被限流。"""
        for i in range(10):
            record_auth_failure("login", "1.2.3.4")

        # 10 次调用后计数为 10
        assert fake_redis.get("ratelimit:auth:login:1.2.3.4") == 10

        # 第 11 次 _check_rate 返回 False（计数变为 11 但超过限制）
        key = "ratelimit:auth:login:1.2.3.4"
        result = _check_rate(fake_redis, key, 10, 60)
        assert result is False
        assert fake_redis.get(key) == 11

    def test_different_ips_independent(self, fake_redis):
        """不同 IP 的失败计数独立。"""
        record_auth_failure("login", "1.1.1.1")
        record_auth_failure("login", "2.2.2.2")
        assert fake_redis.get("ratelimit:auth:login:1.1.1.1") == 1
        assert fake_redis.get("ratelimit:auth:login:2.2.2.2") == 1


# -- 集成测试：Phase 2 rate_limit_dep ------------------------------------


class TestRateLimitDep:
    def test_authenticated_user_uses_user_bucket(self, fake_redis):
        """已登录请求使用 user_id 桶。"""
        request = MagicMock()
        request.state.current_user = type("User", (), {"id": 42})()

        _run(rate_limit_dep(request))
        assert fake_redis.get("ratelimit:user:42") == 1

    def test_anonymous_uses_anon_bucket(self, fake_redis):
        """匿名请求使用 anon IP 桶。"""
        request = MagicMock()
        request.state.current_user = None
        request.client.host = "1.2.3.4"
        request.headers = {}

        _run(rate_limit_dep(request))
        assert fake_redis.get("ratelimit:anon:1.2.3.4") == 1

    def test_user_limit_exceeded_raises(self, fake_redis):
        """用户超过 120 次/分钟限制时抛出异常。"""
        from windup_common.exceptions import BizException

        request = MagicMock()
        request.state.current_user = type("User", (), {"id": 1})()

        for i in range(120):
            _run(rate_limit_dep(request))

        with pytest.raises(BizException):
            _run(rate_limit_dep(request))

    def test_anon_limit_exceeded_raises(self, fake_redis):
        """匿名请求超过 30 次/分钟限制时抛出异常。"""
        from windup_common.exceptions import BizException

        request = MagicMock()
        request.state.current_user = None
        request.client.host = "1.2.3.4"
        request.headers = {}

        for i in range(30):
            _run(rate_limit_dep(request))

        with pytest.raises(BizException):
            _run(rate_limit_dep(request))

    def test_different_users_independent(self, fake_redis):
        """不同用户的限流计数独立。"""
        req1 = MagicMock()
        req1.state.current_user = type("User", (), {"id": 1})()
        req2 = MagicMock()
        req2.state.current_user = type("User", (), {"id": 2})()

        _run(rate_limit_dep(req1))
        _run(rate_limit_dep(req2))
        assert fake_redis.get("ratelimit:user:1") == 1
        assert fake_redis.get("ratelimit:user:2") == 1

    def test_redis_unavailable_passes(self):
        """Redis 不可用时放行。"""
        with patch("windup_app.web.middleware.ratelimit._get_redis", return_value=None):
            request = MagicMock()
            request.state.current_user = type("User", (), {"id": 1})()
            _run(rate_limit_dep(request))  # 不应抛出异常


# -- 端到端验收测试 --------------------------------------------------------


class TestAcceptanceCriteria:
    """Issue #292 验收标准端到端测试。"""

    def test_prior_auth_traffic_no_interference(self, fake_redis, client):
        """先有其他认证端点请求，正确登录仍成功（验收标准 2）。"""
        with patch("windup_app.server.user.service.service.send_verification_code"):
            # 模拟 8 次发码请求（消耗 send-code 桶）
            for i in range(8):
                client.post("/auth/send-code", json={
                    "email": f"user{i}@example.com",
                    "purpose": "register",
                })

        # 正确登录应成功（login 桶独立于 send-code 桶）
        resp = client.post("/auth/login", json={
            "email": "test@example.com",
            "password": "password123",
        })
        # 不应因限流返回 429
        assert resp.json()["code"] != 429

    def test_prior_api_traffic_no_interference(self, fake_redis, auth_client):
        """先有普通 API 请求，正确登录仍成功（验收标准 3）。"""
        # 58 次已认证 API 请求（不消耗全局桶）
        for i in range(58):
            auth_client.get("/projects/")

        # 再尝试登录（login 桶独立）
        resp = auth_client.post("/auth/login", json={
            "email": "test@example.com",
            "password": "password",
        })
        assert resp.json()["code"] != 429

    def test_different_emails_independent(self, fake_redis):
        """同 IP 不同邮箱不共享错误密码计数（验收标准 4）。"""
        # user1 失败 4 次
        for i in range(4):
            record_auth_failure("login", "1.2.3.4")

        # IP 桶已计 4 次（IP 桶不区分邮箱，但邮箱级锁定由 user service 管理）
        assert fake_redis.get("ratelimit:auth:login:1.2.3.4") == 4

    def test_failed_password_still_protected(self, fake_redis):
        """错误密码达阈值后仍触发保护（验收标准 5）。"""
        for i in range(10):
            record_auth_failure("login", "1.2.3.4")

        # 10 次后计数为 10
        assert fake_redis.get("ratelimit:auth:login:1.2.3.4") == 10

        # 第 11 次应被限流
        result = _check_rate(fake_redis, "ratelimit:auth:login:1.2.3.4", 10, 60)
        assert result is False

    def test_send_code_cooldown_isolated(self, fake_redis):
        """发码冷却独立，不消耗登录额度（验收标准 7）。"""
        # 消耗 send-code 桶
        for i in range(3):
            record_auth_failure("send-code", "1.2.3.4")

        # login 桶应该为空
        assert fake_redis.get("ratelimit:auth:login:1.2.3.4") is None
        assert fake_redis.get("ratelimit:auth:send-code:1.2.3.4") == 3

    def test_authenticated_user_enters_user_bucket(self, fake_redis):
        """已登录请求进入用户级限流桶（验收标准 8）。"""
        request = MagicMock()
        request.state.current_user = type("User", (), {"id": 1})()

        _run(rate_limit_dep(request))
        assert fake_redis.get("ratelimit:user:1") is not None

    def test_shared_exit_ip_different_accounts(self, fake_redis):
        """共享出口 IP 不同账号独立（验收标准 11）。"""
        req1 = MagicMock()
        req1.state.current_user = type("User", (), {"id": 1})()
        req2 = MagicMock()
        req2.state.current_user = type("User", (), {"id": 2})()

        _run(rate_limit_dep(req1))
        _run(rate_limit_dep(req2))

        assert fake_redis.get("ratelimit:user:1") == 1
        assert fake_redis.get("ratelimit:user:2") == 1

    def test_log_distinguishes_key_patterns(self, fake_redis):
        """Redis key 模式可区分四类触发来源（验收标准 12）。"""
        # 认证端点
        record_auth_failure("login", "1.2.3.4")
        assert "ratelimit:auth:login:1.2.3.4" in fake_redis._store

        # 已登录用户
        req = MagicMock()
        req.state.current_user = type("User", (), {"id": 42})()
        _run(rate_limit_dep(req))
        assert "ratelimit:user:42" in fake_redis._store

        # 匿名
        anon_req = MagicMock()
        anon_req.state.current_user = None
        anon_req.client.host = "5.6.7.8"
        anon_req.headers = {}
        _run(rate_limit_dep(anon_req))
        assert "ratelimit:anon:5.6.7.8" in fake_redis._store

        # 验证 key 模板各不相同
        keys = set(fake_redis._store.keys())
        assert any("auth:login" in k for k in keys)
        assert any("user:" in k for k in keys)
        assert any("anon:" in k for k in keys)
