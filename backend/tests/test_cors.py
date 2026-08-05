"""本地前后端联调的跨域边界。"""

from fastapi.testclient import TestClient

from windup_app.bootstrap.app import create_app


def test_dev_cors_accepts_vite_on_loopback_address() -> None:
    """直接打开 127.0.0.1 的 Vite 页面时也能轮询生成结果。"""
    client = TestClient(create_app())

    response = client.options(
        "/projects",
        headers={
            "Origin": "http://127.0.0.1:5174",
            "Access-Control-Request-Method": "GET",
        },
    )

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://127.0.0.1:5174"
