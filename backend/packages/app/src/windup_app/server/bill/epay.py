"""易支付 (Epay) 支付提供商实现。

支持支付宝和微信支付等渠道的即时到账接口，使用参数签名进行身份认证与数据防篡改校验。
"""

import hashlib
from typing import Any
import urllib.parse

import httpx

from windup_app.server.bill.provider import (
    PaymentProvider,
    ProviderCreateParams,
    ProviderCreateResult,
    ProviderNotifyResult,
    register_provider,
)
from windup_common.enums.bill import PaymentProviderType
from windup_framework.config.bill import settings as bill_settings


class EpayProvider(PaymentProvider):
    """易支付通道实现。"""

    def __init__(
        self,
        pid: int | None = None,
        key: str | None = None,
        notify_url: str | None = None,
        return_url: str | None = None,
        api_url: str = "https://pay.example.com",
    ) -> None:
        self.pid = pid if pid is not None else bill_settings.epay_pid
        self.key = key if key is not None else (bill_settings.epay_private_key or bill_settings.epay_public_key)
        self.notify_url = notify_url if notify_url is not None else bill_settings.epay_notify_url
        self.return_url = return_url if return_url is not None else bill_settings.epay_return_url
        self.api_url = api_url.rstrip("/")

    @staticmethod
    def sign_params(params: dict[str, Any], key: str) -> str:
        """根据易支付签名规则生成签名。

        规则：
        1. 筛选出所有非空且不为 sign、sign_type 的键值对；
        2. 按照字典序升序对键进行排序；
        3. 用 key1=val1&key2=val2 拼接成待签名字符串；
        4. 待签名字符串末尾拼接 key 密钥（即 string + key）；
        5. 对完整拼接字符串进行 MD5 哈希计算，输出小写 32 位 hex。
        """
        filtered_items = [
            (k, str(v))
            for k, v in params.items()
            if k not in ("sign", "sign_type") and v is not None and str(v) != ""
        ]
        filtered_items.sort(key=lambda x: x[0])
        sign_str = "&".join(f"{k}={v}" for k, v in filtered_items)
        return hashlib.md5((sign_str + key).encode("utf-8")).hexdigest()

    def create_order(self, params: ProviderCreateParams) -> ProviderCreateResult:
        """构建易支付收银台跳转 URL。"""
        # 金额转换为元，保留两位小数
        money_yuan = f"{params.amount_fen / 100:.2f}"
        data = {
            "pid": self.pid,
            "type": params.channel,
            "out_trade_no": params.order_no,
            "notify_url": params.notify_url or self.notify_url,
            "return_url": params.return_url or self.return_url,
            "name": params.name or f"Order_{params.order_no}",
            "money": money_yuan,
            "clientip": params.client_ip,
        }
        sign = self.sign_params(data, self.key)
        data["sign"] = sign
        data["sign_type"] = "MD5"

        query_string = urllib.parse.urlencode(data)
        pay_url = f"{self.api_url}/submit.php?{query_string}"
        return ProviderCreateResult(
            order_no=params.order_no,
            pay_url=pay_url,
            provider_trade_no=None,
            raw_data=data,
        )

    def verify_notify(self, payload: dict[str, Any]) -> ProviderNotifyResult:
        """验证易支付异步回调通知。

        :raises ValueError: 签名不匹配或缺少关键参数。
        """
        sign_received = payload.get("sign")
        if not sign_received:
            raise ValueError("Missing sign parameter in notify payload")

        calculated_sign = self.sign_params(payload, self.key)
        if calculated_sign.lower() != str(sign_received).lower():
            raise ValueError("Invalid epay notify signature")

        order_no = str(payload.get("out_trade_no", ""))
        provider_trade_no = str(payload.get("trade_no", ""))
        trade_status = str(payload.get("trade_status", ""))

        # 金额由字符串转换为分
        money_str = payload.get("money")
        amount_fen = int(round(float(money_str) * 100)) if money_str is not None else 0

        return ProviderNotifyResult(
            order_no=order_no,
            provider_trade_no=provider_trade_no,
            amount_fen=amount_fen,
            status=trade_status,
            raw_payload=payload,
        )

    def close_order(self, order_no: str) -> bool:
        """尝试向上游易支付网关发起关单（尽力而为）。"""
        # 易支付通用接口：部分对接网关提供 api.php?act=orders 或关单接口，若失败返回 False
        try:
            with httpx.Client(timeout=5.0) as client:
                data = {
                    "act": "close",
                    "pid": self.pid,
                    "out_trade_no": order_no,
                }
                data["sign"] = self.sign_params(data, self.key)
                data["sign_type"] = "MD5"
                resp = client.post(f"{self.api_url}/api.php", data=data)
                return resp.status_code == 200
        except Exception:
            return False


# 注册默认 Epay 单例
register_provider(PaymentProviderType.EPAY, EpayProvider())
