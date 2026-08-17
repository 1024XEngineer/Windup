"""内测关闭公开注册：公开建号路径必须被拒绝。"""

from windup_common.enums.biz_code import BizCode


def test_register_endpoint_rejects_public_signup(client):
    resp = client.post(
        "/auth/register",
        json={
            "email": "new@example.com",
            "password": "password123",
            "code": "123456",
        },
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["code"] == BizCode.BAD_REQUEST
    assert body["message"] == "内测期间暂不开放注册"
    assert body["data"] is None


def test_send_code_rejects_register_purpose(client):
    resp = client.post(
        "/auth/send-code",
        json={"email": "new@example.com", "purpose": "register"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["code"] == BizCode.BAD_REQUEST
    assert body["message"] == "内测期间暂不开放注册"
