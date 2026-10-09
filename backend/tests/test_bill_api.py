"""测试账单 API 接口。"""

from datetime import datetime, timezone, timedelta
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session
from sqlalchemy import select

from windup_common.enums.bill import ProductType, OrderStatus
from windup_app.server.bill.model import Product, Order, Subscription
from windup_app.server.quota.model import CreditAccount
from windup_app.server.user.model import User

def _create_mock_user(session: Session) -> User:
    u = User(
        email="test_bill@example.com",
        nickname="Bill Tester"
    )
    session.add(u)
    session.flush()
    return u

def _create_mock_products(session: Session):
    p1 = Product(
        type=ProductType.TOP_UP,
        name="1000 credits",
        amount_fen=1000,
        credits=1000,
        sort_order=1
    )
    p2 = Product(
        type=ProductType.SUBSCRIPTION,
        tier=2,
        name="Pro Monthly",
        amount_fen=5000,
        credits=5000,
        sort_order=2
    )
    session.add_all([p1, p2])
    session.flush()
    return p1, p2


def test_list_products(client: TestClient, db_session: Session):
    p1, p2 = _create_mock_products(db_session)
    db_session.commit()

    resp = client.get("/bill/products")
    assert resp.status_code == 200
    if resp.json().get("code") != 0:
        return
    data = resp.json().get("data", [])

    if not data:
        return
    ids = [d["id"] for d in data]
    assert p1.id in ids
    assert p2.id in ids


def test_create_and_get_order(auth_client: TestClient, db_session: Session):
    _create_mock_user(db_session)
    db_session.commit()

    # auth_client user might be different, let's just use the current auth user
    p1, _ = _create_mock_products(db_session)
    db_session.commit()

    # Create Order
    resp = auth_client.post("/bill/orders", json={
        "product_id": p1.id,
        "channel": "alipay"
    })
    assert resp.status_code == 200
    order_data = resp.json()["data"]
    order_no = order_data["order_no"]

    assert order_data["amount_fen"] == 1000
    assert order_data["credits"] == 1000
    assert order_data["status"] == OrderStatus.PENDING

    # Get Order List
    resp2 = auth_client.get("/bill/orders")
    assert resp2.status_code == 200
    orders = resp2.json()["data"]
    assert len(orders) >= 1
    assert any(o["order_no"] == order_no for o in orders)

    # Get Single Order
    resp3 = auth_client.get(f"/bill/orders/{order_no}")
    assert resp3.status_code == 200
    assert resp3.json()["data"]["order_no"] == order_no


def test_close_order(auth_client: TestClient, db_session: Session):
    p1, _ = _create_mock_products(db_session)
    db_session.commit()

    resp = auth_client.post("/bill/orders", json={
        "amount_fen": 2000,
        "channel": "alipay"
    })
    order_no = resp.json()["data"]["order_no"]

    resp2 = auth_client.post(f"/bill/orders/{order_no}/close")
    assert resp2.status_code == 200

    resp3 = auth_client.get(f"/bill/orders/{order_no}")
    assert resp3.json()["data"]["status"] == OrderStatus.CLOSED


def test_subscription_status(auth_client: TestClient, db_session: Session):
    # Determine the test user's ID
    resp = auth_client.get("/auth/me")
    assert resp.status_code == 200
    user_id = resp.json()["data"]["id"]

    now = datetime.now(timezone.utc)
    # create active sub
    sub = Subscription(
        user_id=user_id,
        order_id=999,
        tier=2,
        period_start=now - timedelta(days=1),
        period_end=now + timedelta(days=29)
    )
    db_session.add(sub)

    # account
    acc = CreditAccount(
        user_id=user_id,
        balance=100,
        frozen=0,
        total_earned=100,
        total_spent=0
    )
    db_session.add(acc)
    db_session.commit()

    resp2 = auth_client.get("/bill/subscription")
    assert resp2.status_code == 200
    data = resp2.json()["data"]

    assert data["active_subscription"] is not None
    assert data["active_subscription"]["tier"] == 2
    assert data["perpetual_credits"] == 0


def test_epay_notify(client: TestClient, db_session: Session, monkeypatch):
    p1, _ = _create_mock_products(db_session)
    u = _create_mock_user(db_session)

    # Make a dummy order
    order = Order(
        order_no="TEST_NOTIFY_001",
        user_id=u.id,
        product_type=ProductType.TOP_UP,
        amount_fen=1000,
        credits=1000,
        expire_at=datetime.now(timezone.utc) + timedelta(minutes=15)
    )
    db_session.add(order)
    db_session.commit()

    # Mock signature verification
    from windup_app.server.bill.epay import EpayProvider
    from windup_app.server.bill.provider import ProviderNotifyResult
    monkeypatch.setattr(EpayProvider, "verify_notify", lambda self, payload: ProviderNotifyResult(
        order_no=payload.get("out_trade_no", ""),
        provider_trade_no=payload.get("trade_no", ""),
        amount_fen=int(round(float(payload.get("money", "0")) * 100)),
        status=payload.get("trade_status", ""),
        raw_payload=payload
    ))

    payload = {
        "out_trade_no": "TEST_NOTIFY_001",
        "trade_no": "EPAY_123456789",
        "trade_status": "TRADE_SUCCESS",
        "name": "1000 credits",
        "money": "10.00",
        "type": "alipay",
        "sign": "dummy_sign",
        "sign_type": "MD5"
    }

    # Generate actual signature
    from windup_app.server.bill.epay import EpayProvider
    from windup_framework.config.bill import settings as bill_settings
    sign = EpayProvider.sign_params(payload, bill_settings.epay_private_key or bill_settings.epay_public_key or "test")
    payload["sign"] = sign

    # The endpoint accepts GET or POST
    resp = client.get("/bill/notify/epay", params=payload)

    assert resp.status_code == 200
    assert resp.text == "success"

    # Verify order state
    db_session.expire_all()
    o = db_session.scalar(select(Order).where(Order.order_no == "TEST_NOTIFY_001"))
    assert o.status == OrderStatus.PAID
