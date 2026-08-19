"""无效邀请码不得建号。"""

from windup_common.enums.biz_code import BizCode

from windup_app.server.user.model import User


def test_register_endpoint_rejects_invalid_invite_code(client, db_session):
    resp = client.post(
        "/auth/register",
        json={
            "email": "new@example.com",
            "password": "password123",
            "code": "123456",
            "invite_code": "NOPE1234",
        },
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["code"] == BizCode.BAD_REQUEST
    assert body["message"] == "邀请码无效"
    assert (
        db_session.query(User).filter(User.email == "new@example.com").one_or_none()
        is None
    )
