"""CORS 预检请求测试。

覆盖公共接口与受保护接口的 OPTIONS 预检请求，确保：
1. 已配置来源的预检请求返回正确的 CORS 响应头
2. 预检请求不需要 Authorization header
3. 未配置来源的请求不获得 CORS 头
"""

import os
from unittest import mock


class TestCORSPreflight:
    """CORS 预检请求测试。"""

    def test_public_endpoint_preflight(self, client):
        """公共接口（如 /auth/login）的 OPTIONS 预检请求应返回 CORS 头。"""
        resp = client.options(
            "/auth/login",
            headers={
                "Origin": "http://localhost:5173",
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "Content-Type",
            },
        )
        assert resp.status_code == 200
        assert "access-control-allow-origin" in resp.headers
        assert "access-control-allow-methods" in resp.headers
        assert "access-control-allow-headers" in resp.headers

    def test_protected_endpoint_preflight_without_token(self, client):
        """受保护接口的 OPTIONS 预检请求不需要 token，应返回 CORS 头。"""
        # 测试多个受保护接口
        protected_endpoints = [
            "/auth/me",
            "/auth/profile",
            "/auth/change-password",
            "/projects",
        ]

        for endpoint in protected_endpoints:
            resp = client.options(
                endpoint,
                headers={
                    "Origin": "http://localhost:5173",
                    "Access-Control-Request-Method": "GET",
                    "Access-Control-Request-Headers": "Authorization, Content-Type",
                },
            )
            assert resp.status_code == 200, f"Failed for {endpoint}"
            assert "access-control-allow-origin" in resp.headers, f"Failed for {endpoint}"
            assert "access-control-allow-methods" in resp.headers, f"Failed for {endpoint}"
            assert "access-control-allow-headers" in resp.headers, f"Failed for {endpoint}"

    def test_protected_endpoint_preflight_with_various_methods(self, client):
        """受保护接口应支持多种 HTTP 方法的预检请求。"""
        methods = ["GET", "PATCH", "POST", "PUT", "DELETE"]

        for method in methods:
            resp = client.options(
                "/auth/me",
                headers={
                    "Origin": "http://localhost:5173",
                    "Access-Control-Request-Method": method,
                    "Access-Control-Request-Headers": "Authorization, Content-Type",
                },
            )
            assert resp.status_code == 200, f"Failed for method {method}"
            assert "access-control-allow-origin" in resp.headers, f"Failed for method {method}"
            assert "access-control-allow-methods" in resp.headers, f"Failed for method {method}"

    def test_unconfigured_origin_not_allowed(self, client):
        """未配置来源的请求不应获得 CORS 头。"""
        resp = client.options(
            "/auth/login",
            headers={
                "Origin": "https://malicious-site.com",
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "Content-Type",
            },
        )
        # 未配置来源应该返回 400 或者不包含 allow-origin
        assert "access-control-allow-origin" not in resp.headers

    def test_actual_request_still_requires_auth(self, client):
        """预检成功后，实际受保护请求仍必须通过 JWT 鉴权。"""
        # 先发送预检请求
        client.options(
            "/auth/me",
            headers={
                "Origin": "http://localhost:5173",
                "Access-Control-Request-Method": "GET",
                "Access-Control-Request-Headers": "Authorization",
            },
        )

        # 发送实际请求但不带 token
        resp = client.get("/auth/me")
        assert resp.status_code == 200
        body = resp.json()
        assert body["code"] == 401

    def test_actual_request_with_valid_token(self, auth_client):
        """带有效 token 的实际请求应正常通过。"""
        resp = auth_client.get("/auth/me")
        # 不是 401 就算通过（可能是业务层的其他状态码）
        assert resp.json().get("code") != 401

    def test_preflight_with_credentials(self, client):
        """预检请求应支持 credentials（带 Cookie 的跨域请求）。"""
        resp = client.options(
            "/auth/login",
            headers={
                "Origin": "http://localhost:5173",
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "Content-Type",
            },
        )
        assert resp.status_code == 200
        assert resp.headers.get("access-control-allow-credentials") == "true"

    def test_preflight_max_age(self, client):
        """预检响应应包含 max-age 头，缓存预检结果。"""
        resp = client.options(
            "/auth/login",
            headers={
                "Origin": "http://localhost:5173",
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "Content-Type",
            },
        )
        assert resp.status_code == 200
        # Starlette 默认设置 max-age=600
        assert "access-control-max-age" in resp.headers

    def test_multiple_origins_configured(self, client):
        """配置多个来源时，每个来源都应被允许。"""
        # 默认配置包含 localhost:5173 和 localhost:3000
        origins = ["http://localhost:5173", "http://localhost:3000"]

        for origin in origins:
            resp = client.options(
                "/auth/login",
                headers={
                    "Origin": origin,
                    "Access-Control-Request-Method": "POST",
                },
            )
            assert resp.status_code == 200, f"Failed for origin {origin}"
            assert resp.headers.get("access-control-allow-origin") == origin, f"Failed for origin {origin}"


class TestCORSPreflightWithCustomOrigins:
    """使用自定义 CORS 来源的测试。"""

    def test_custom_origin_allowed(self, client):
        """自定义来源应被允许。"""
        custom_origin = "https://frontend.example"

        with mock.patch.dict(os.environ, {"WINDUP_CORS_ORIGINS": custom_origin}):
            # 重新加载 app 以使用新的环境变量
            from windup_app.bootstrap.app import create_app
            from fastapi.testclient import TestClient

            app = create_app()
            test_client = TestClient(app)

            resp = test_client.options(
                "/auth/login",
                headers={
                    "Origin": custom_origin,
                    "Access-Control-Request-Method": "POST",
                },
            )
            assert resp.status_code == 200
            assert resp.headers.get("access-control-allow-origin") == custom_origin

    def test_custom_origin_not_allowed(self, client):
        """未配置的来源不应被允许。"""
        custom_origin = "https://frontend.example"
        other_origin = "https://other-site.com"

        with mock.patch.dict(os.environ, {"WINDUP_CORS_ORIGINS": custom_origin}):
            from windup_app.bootstrap.app import create_app
            from fastapi.testclient import TestClient

            app = create_app()
            test_client = TestClient(app)

            resp = test_client.options(
                "/auth/login",
                headers={
                    "Origin": other_origin,
                    "Access-Control-Request-Method": "POST",
                },
            )
            assert "access-control-allow-origin" not in resp.headers

    def test_vercel_preview_domain_not_allowed_by_default(self):
        """默认不应信任任意 Vercel 预览域名。"""
        with mock.patch.dict(os.environ):
            os.environ.pop("WINDUP_CORS_ORIGIN_REGEX", None)

            from windup_app.bootstrap.app import create_app
            from fastapi.testclient import TestClient

            test_client = TestClient(create_app())
            resp = test_client.options(
                "/auth/login",
                headers={
                    "Origin": "https://evil.vercel.app",
                    "Access-Control-Request-Method": "POST",
                },
            )

        assert "access-control-allow-origin" not in resp.headers

    def test_project_scoped_vercel_regex_allowed(self):
        """部署方可显式允许自己项目的 Vercel 预览域名。"""
        regex = r"https://windup-.*\.vercel\.app"
        with mock.patch.dict(os.environ, {"WINDUP_CORS_ORIGIN_REGEX": regex}):
            from windup_app.bootstrap.app import create_app
            from fastapi.testclient import TestClient

            test_client = TestClient(create_app())
            allowed_resp = test_client.options(
                "/auth/login",
                headers={
                    "Origin": "https://windup-feature-123.vercel.app",
                    "Access-Control-Request-Method": "POST",
                },
            )
            rejected_resp = test_client.options(
                "/auth/login",
                headers={
                    "Origin": "https://evil.vercel.app",
                    "Access-Control-Request-Method": "POST",
                },
            )

        assert allowed_resp.headers.get("access-control-allow-origin") == (
            "https://windup-feature-123.vercel.app"
        )
        assert "access-control-allow-origin" not in rejected_resp.headers
