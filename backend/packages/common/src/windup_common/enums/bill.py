"""支付与订阅共享枚举。"""

from enum import IntEnum


class ProductType(IntEnum):
    """商品类型。"""

    TOP_UP = 1         # 积分充值
    SUBSCRIPTION = 2   # 会员订阅


class SubscriptionTier(IntEnum):
    """订阅会员等级。"""

    PLUS = 1
    PRO = 2
    MAX = 3


class OrderStatus(IntEnum):
    """订单状态。"""

    PENDING = 0     # 待支付
    PAID = 1        # 已支付
    CLOSED = 2      # 已关闭
    REFUNDING = 3   # 退款中
    REFUNDED = 4    # 已退款


class PaymentProviderType(IntEnum):
    """支付网关提供商类型。"""

    EPAY = 1    # 易支付
    STRIPE = 2  # Stripe


class SubscriptionStatus(IntEnum):
    """订阅状态。"""

    PENDING_START = 0  # 待生效（续订预排期）
    ACTIVE = 1         # 生效中
    EXPIRED = 2        # 已到期


class PaymentEventType(IntEnum):
    """支付回调事件类型。"""

    PAY_NOTIFY = 1     # 支付通知
    REFUND_NOTIFY = 2  # 退款通知
