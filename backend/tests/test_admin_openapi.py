"""独立管理端 OpenAPI 与普通用户认证隔离验收。"""


def test_admin_auth_schema_exposes_identity_but_never_tokens(client):
    schema = client.get("/openapi.json").json()
    paths = schema["paths"]

    assert "/admin-api/auth/login" in paths
    assert "/admin-api/auth/refresh" in paths
    assert "/admin-api/auth/me" in paths
    assert "/admin-api/auth/logout" in paths

    admin_schema = str(
        {
            path: value
            for path, value in paths.items()
            if path.startswith("/admin-api/")
        }
    ).lower()
    assert "access_token" not in admin_schema
    assert "refresh_token" not in admin_schema
    assert "authorization" not in admin_schema


def test_admin_path_rejects_normal_bearer_without_admin_cookie(auth_client):
    response = auth_client.get("/admin-api/auth/me")

    assert response.status_code == 200
    assert response.json()["code"] == 401
