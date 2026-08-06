"""CORS 中间件：浏览器能不能连上后端，以及不放行陌生来源。

这类问题只在真实浏览器请求时才暴露——预检被拦时后端日志里连请求都看不到，
很容易被误判成后端挂了。所以在 CI 里各钉一颗钉子。
"""

from fastapi.testclient import TestClient

from windup_app.bootstrap.app import create_app

PREVIEW_ORIGIN = "https://windup-git-main-preview.example.app"


def _preflight(client: TestClient, origin: str):
    return client.options(
        "/media/upload",
        headers={"Origin": origin, "Access-Control-Request-Method": "POST"},
    )


def test_configured_origin_passes_preflight(monkeypatch):
    monkeypatch.setenv("WINDUP_CORS_ORIGINS", "https://windup.example.com")
    monkeypatch.delenv("WINDUP_CORS_ORIGIN_REGEX", raising=False)
    client = TestClient(create_app())

    resp = _preflight(client, "https://windup.example.com")

    assert resp.status_code == 200
    assert resp.headers["access-control-allow-origin"] == "https://windup.example.com"


def test_vite_preview_port_is_allowed_by_default(monkeypatch):
    """本地看真实生产构建走的是 `vite preview` 的 **4173**，不是 dev 的 5173。

    默认值漏掉 4173 的话，前端每个请求都会被浏览器拦在预检，
    而后端日志里连请求都看不到 —— 极易误判成后端挂了。
    """
    monkeypatch.delenv("WINDUP_CORS_ORIGINS", raising=False)
    monkeypatch.delenv("WINDUP_CORS_ORIGIN_REGEX", raising=False)
    client = TestClient(create_app())

    for origin in ("http://localhost:4173", "http://localhost:5173"):
        resp = _preflight(client, origin)
        assert resp.headers.get("access-control-allow-origin") == origin, origin


def test_unknown_origin_is_rejected_by_default(monkeypatch):
    """默认不带任何平台通配 —— 后端开了 allow_credentials，
    通配一个托管平台的域等于把带凭证的跨域请求放行给平台上任意第三方应用。
    """
    monkeypatch.setenv("WINDUP_CORS_ORIGINS", "https://windup.example.com")
    monkeypatch.delenv("WINDUP_CORS_ORIGIN_REGEX", raising=False)
    client = TestClient(create_app())

    resp = _preflight(client, "https://someone-elses-app.example.app")

    assert "access-control-allow-origin" not in resp.headers


def test_preview_regex_is_opt_in_and_scoped(monkeypatch):
    """预览域名要放行就显式配正则，且只匹配自家项目的域名形态。"""
    monkeypatch.setenv("WINDUP_CORS_ORIGINS", "https://windup.example.com")
    monkeypatch.setenv(
        "WINDUP_CORS_ORIGIN_REGEX", r"https://windup-[a-z0-9-]+\.example\.app"
    )
    client = TestClient(create_app())

    allowed = _preflight(client, PREVIEW_ORIGIN)
    assert allowed.headers["access-control-allow-origin"] == PREVIEW_ORIGIN

    stranger = _preflight(client, "https://someone-elses-app.example.app")
    assert "access-control-allow-origin" not in stranger.headers
