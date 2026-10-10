"""支付提供商策略接口与注册表。

定义统一支付网关抽象及标准化 DTO。
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, Literal

from windup_common.enums.bill import PaymentProviderType


@dataclass
class ProviderCreateParams:
    """创建支付订单入参。"""

    order_no: str
    amount_fen: int
    channel: str
    name: str = ""
    notify_url: str = ""
    return_url: str = ""
    client_ip: str = "127.0.0.1"
    extra_params: dict[str, Any] = field(default_factory=dict)


@dataclass
class ProviderCreateResult:
    """创建支付订单返回结果。"""

    order_no: str
    pay_url: str
    provider_trade_no: str | None = None
    raw_data: dict[str, Any] = field(default_factory=dict)


@dataclass
class ProviderNotifyResult:
    """支付回调通知解析结果。"""

    order_no: str
    provider_trade_no: str
    amount_fen: int
    status: str
    raw_payload: dict[str, Any] = field(default_factory=dict)


@dataclass
class ProviderQueryResult:
    """主动查询上游订单结果。

    status 四态：paid（已支付，金额带回应由调用方校验）、unpaid（明确的未支付）、
    not_found（上游查无此单）、unknown（网关不可达 / 响应不可解析 / 契约不符）。
    unknown 语义下调用方不得迁移任何终态，只能保持可重试状态。
    """

    order_no: str
    provider_trade_no: str | None
    amount_fen: int
    status: Literal["paid", "unpaid", "not_found", "unknown"]
    raw_data: dict[str, Any] = field(default_factory=dict)


class PaymentProvider(ABC):
    """支付提供商抽象基类。"""

    @abstractmethod
    def create_order(self, params: ProviderCreateParams) -> ProviderCreateResult:
        """向上游支付通道发起统一下单或生成支付跳转链接。"""

    @abstractmethod
    def verify_notify(self, payload: dict[str, Any]) -> ProviderNotifyResult:
        """验证异步回调通知签名并解析标准化支付结果。"""

    @abstractmethod
    def query_order(self, order_no: str) -> ProviderQueryResult:
        """向上游支付通道主动查询订单支付结果。"""

    @abstractmethod
    def close_order(self, order_no: str) -> bool:
        """向上游支付通道发起关闭订单请求。"""


_PROVIDERS: dict[PaymentProviderType | int, PaymentProvider] = {}


def register_provider(
    provider_type: PaymentProviderType | int,
    provider: PaymentProvider,
) -> None:
    """注册支付提供商实例。"""
    _PROVIDERS[provider_type] = provider


def get_provider(
    provider_type: PaymentProviderType | int,
) -> PaymentProvider:
    """根据提供商类型获取对应的支付提供商实例。

    :raises KeyError: 如果指定的支付提供商尚未注册。
    """
    if provider_type not in _PROVIDERS:
        raise KeyError(f"Payment provider not registered: {provider_type}")
    return _PROVIDERS[provider_type]
