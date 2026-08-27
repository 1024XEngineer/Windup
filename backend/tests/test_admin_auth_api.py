from fastapi.testclient import TestClient
from sqlalchemy import select

from windup_app.server.admin.audit import AdminAuditLog
from windup_app.server.admin.model import AdminPermission, AdminRole, AdminUser
from windup_app.server.admin.permissions import AUDIT_READ
from windup_app.server.admin.service import hash_admin_password

ACCESS_COOKIE = "windup_admin_access"
REFRESH_COOKIE = "windup_admin_refresh"
CSRF_COOKIE = "windup_admin_csrf"


def _seed_admin(db_session) -> AdminUser:
    permission = AdminPermission(code=AUDIT_READ, name="查看审计")
    role = AdminRole(code="auditor", name="审计员", permissions=[permission])
    admin = AdminUser(
        email="owner@example.com",
        password_hash=hash_admin_password("correct-password"),
        roles=[role],
    )
    db_session.add(admin)
    db_session.commit()
    return admin


def _admin_client(client) -> TestClient:
    return TestClient(client.app, base_url="https://admin.windup.xin")


def _login(admin_client: TestClient):
    return admin_client.post(
        "/admin-api/auth/login",
        json={"email": "owner@example.com", "password": "correct-password"},
    )


def test_normal_user_bearer_cannot_access_admin_me(auth_client):
    response = auth_client.get("/admin-api/auth/me")

    assert response.json()["code"] == 401


def test_admin_login_sets_strict_cookie_session_without_returning_tokens(client, db_session):
    _seed_admin(db_session)
    admin_client = _admin_client(client)
    try:
        response = _login(admin_client)
    finally:
        admin_client.close()

    body = response.json()
    assert body["code"] == 200
    assert body["data"] == {
        "admin": {
            "id": body["data"]["admin"]["id"],
            "email": "owner@example.com",
            "permissions": [AUDIT_READ],
        }
    }
    assert "access_token" not in str(body)
    set_cookie = response.headers.get_list("set-cookie")
    access_header = next(value for value in set_cookie if value.startswith(f"{ACCESS_COOKIE}="))
    refresh_header = next(value for value in set_cookie if value.startswith(f"{REFRESH_COOKIE}="))
    csrf_header = next(value for value in set_cookie if value.startswith(f"{CSRF_COOKIE}="))
    assert "HttpOnly" in access_header and "Secure" in access_header
    assert "HttpOnly" in refresh_header and "Secure" in refresh_header
    assert "HttpOnly" not in csrf_header and "Secure" in csrf_header
    assert all("SameSite=strict" in value for value in set_cookie)


def test_admin_cookie_can_access_me_and_normal_bearer_is_ignored(client, db_session):
    _seed_admin(db_session)
    admin_client = _admin_client(client)
    try:
        assert _login(admin_client).json()["code"] == 200
        response = admin_client.get(
            "/admin-api/auth/me",
            headers={"Authorization": "Bearer normal-user-token"},
        )
    finally:
        admin_client.close()

    assert response.json()["data"]["admin"]["email"] == "owner@example.com"


def test_admin_refresh_requires_csrf_and_rotates_refresh_cookie(client, db_session):
    _seed_admin(db_session)
    admin_client = _admin_client(client)
    try:
        assert _login(admin_client).json()["code"] == 200
        original_refresh = admin_client.cookies.get(REFRESH_COOKIE)
        rejected = admin_client.post("/admin-api/auth/refresh")
        csrf = admin_client.cookies.get(CSRF_COOKIE)
        accepted = admin_client.post(
            "/admin-api/auth/refresh",
            headers={"X-CSRF-Token": csrf or ""},
        )
        rotated_refresh = admin_client.cookies.get(REFRESH_COOKIE)
    finally:
        admin_client.close()

    assert rejected.json()["code"] == 403
    assert accepted.json()["code"] == 200
    assert rotated_refresh and rotated_refresh != original_refresh


def test_admin_logout_requires_csrf_then_clears_session(client, db_session):
    _seed_admin(db_session)
    admin_client = _admin_client(client)
    try:
        assert _login(admin_client).json()["code"] == 200
        rejected = admin_client.post(
            "/admin-api/auth/logout",
            headers={"X-CSRF-Token": "wrong"},
        )
        csrf = admin_client.cookies.get(CSRF_COOKIE)
        accepted = admin_client.post(
            "/admin-api/auth/logout",
            headers={"X-CSRF-Token": csrf or ""},
        )
        after_logout = admin_client.get("/admin-api/auth/me")
    finally:
        admin_client.close()

    assert rejected.json()["code"] == 403
    assert accepted.json()["code"] == 200
    assert after_logout.json()["code"] == 401


def test_admin_login_and_logout_are_audited_without_secrets(client, db_session):
    _seed_admin(db_session)
    admin_client = _admin_client(client)
    try:
        assert _login(admin_client).json()["code"] == 200
        csrf = admin_client.cookies.get(CSRF_COOKIE)
        assert admin_client.post(
            "/admin-api/auth/logout",
            headers={"X-CSRF-Token": csrf or ""},
        ).json()["code"] == 200
    finally:
        admin_client.close()

    db_session.expire_all()
    rows = db_session.scalars(select(AdminAuditLog).order_by(AdminAuditLog.id)).all()
    assert [row.action for row in rows] == ["auth.login", "auth.logout"]
    assert all("password" not in str(row.after_summary or {}) for row in rows)
    assert all("token" not in str(row.after_summary or {}) for row in rows)
