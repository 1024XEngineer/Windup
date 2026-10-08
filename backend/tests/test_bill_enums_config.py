from windup_common.enums.bill import (
    OrderStatus,
    PaymentEventType,
    PaymentProviderType,
    ProductType,
    SubscriptionStatus,
    SubscriptionTier,
)
from windup_common.enums.quota import CreditReason
from windup_framework.config import BillSettings, bill_settings
from windup_framework.config.bill import settings


def test_enums_and_config():
    # Quota CreditReason
    assert CreditReason.TOP_UP == 10
    assert CreditReason.SUBSCRIPTION == 11
    assert CreditReason.SUBSCRIPTION_EXPIRE == 12

    # ProductType
    assert ProductType.TOP_UP == 1
    assert ProductType.SUBSCRIPTION == 2

    # SubscriptionTier
    assert SubscriptionTier.PLUS == 1
    assert SubscriptionTier.PRO == 2
    assert SubscriptionTier.MAX == 3

    # OrderStatus
    assert OrderStatus.PENDING == 0
    assert OrderStatus.PAID == 1
    assert OrderStatus.CLOSED == 2
    assert OrderStatus.REFUNDING == 3
    assert OrderStatus.REFUNDED == 4

    # PaymentProviderType
    assert PaymentProviderType.EPAY == 1
    assert PaymentProviderType.STRIPE == 2

    # SubscriptionStatus
    assert SubscriptionStatus.PENDING_START == 0
    assert SubscriptionStatus.ACTIVE == 1
    assert SubscriptionStatus.EXPIRED == 2

    # PaymentEventType
    assert PaymentEventType.PAY_NOTIFY == 1
    assert PaymentEventType.REFUND_NOTIFY == 2

    # BillSettings
    assert isinstance(settings, BillSettings)
    assert settings is bill_settings
    assert hasattr(settings, "epay_pid")
    assert hasattr(settings, "epay_private_key")
    assert hasattr(settings, "epay_public_key")
    assert hasattr(settings, "epay_notify_url")
    assert hasattr(settings, "epay_return_url")
    assert settings.epay_pid == 0
    assert settings.epay_private_key == ""
    assert settings.epay_public_key == ""
    assert settings.epay_notify_url == ""
    assert settings.epay_return_url == ""
