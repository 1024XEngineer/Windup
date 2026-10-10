import pytest

from windup_app.server.bill.epay import EpayProvider
from windup_app.server.bill.provider import (
    ProviderCreateParams,
    get_provider,
)
from windup_common.enums.bill import PaymentProviderType


def test_epay_provider_initialization_and_registry():
    provider = EpayProvider()
    assert provider is not None
    # 验证获取注册的 provider
    registered = get_provider(PaymentProviderType.EPAY)
    assert registered is not None
    assert isinstance(registered, EpayProvider)


def test_epay_sign_and_verify():
    provider = EpayProvider(
        pid=1001,
        key="test_secret_key",
        notify_url="https://api.example.com/notify",
        return_url="https://api.example.com/return",
    )
    # 验证生成订单时自动带上 sign
    create_params = ProviderCreateParams(
        order_no="ORD202610080001",
        amount_fen=1000,
        channel="alipay",
        name="Test Order",
        client_ip="127.0.0.1",
    )
    result = provider.create_order(create_params)
    assert result.order_no == "ORD202610080001"
    assert "submit.php?" in result.pay_url

    expected_data = {
        "pid": 1001,
        "type": "alipay",
        "out_trade_no": "ORD202610080001",
        "notify_url": "https://api.example.com/notify",
        "return_url": "https://api.example.com/return",
        "name": "Test Order",
        "money": "10.00",
        "clientip": "127.0.0.1",
    }
    expected_sign = provider.sign_params(expected_data, "test_secret_key")
    assert f"sign={expected_sign}" in result.pay_url

    # 验证回调通知验签成功
    notify_payload = {
        "pid": 1001,
        "trade_no": "EPAY998877",
        "out_trade_no": "ORD202610080001",
        "type": "alipay",
        "name": "Test Order",
        "money": "10.00",
        "trade_status": "TRADE_SUCCESS",
        "sign": provider.sign_params(
            {
                "pid": 1001,
                "trade_no": "EPAY998877",
                "out_trade_no": "ORD202610080001",
                "type": "alipay",
                "name": "Test Order",
                "money": "10.00",
                "trade_status": "TRADE_SUCCESS",
            },
            "test_secret_key",
        ),
        "sign_type": "MD5",
    }
    notify_res = provider.verify_notify(notify_payload)
    assert notify_res.order_no == "ORD202610080001"
    assert notify_res.provider_trade_no == "EPAY998877"
    assert notify_res.amount_fen == 1000
    assert notify_res.status == "TRADE_SUCCESS"

    # 验证回调通知验签失败
    bad_payload = dict(notify_payload)
    bad_payload["sign"] = "invalid_signature"
    with pytest.raises(ValueError, match="Invalid epay notify signature"):
        provider.verify_notify(bad_payload)

    # 验证缺少 sign 字段
    del bad_payload["sign"]
    with pytest.raises(ValueError, match="Missing sign parameter"):
        provider.verify_notify(bad_payload)


def test_epay_close_order():
    provider = EpayProvider(pid=1001, key="test_secret_key")
    # 网络失败或不存在服务时返回 False
    assert provider.close_order("ORD202610080001") is False


def test_get_unregistered_provider():
    with pytest.raises(KeyError):
        get_provider(99999)

