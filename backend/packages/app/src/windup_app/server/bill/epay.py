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
    ProviderQueryResult,
    register_provider,
)
from windup_common.enums.bill import PaymentProviderType
from windup_framework.config.bill import settings as bill_settings

# 未配置 WINDUP_BILL_EPAY_API_URL 时的回落地址（测试环境）。
# 生产部署必须配置真实网关，否则下单不可用。
_FALLBACK_API_URL = "https://pay.example.com"


class EpayProvider(PaymentProvider):
    """易支付通道实现。"""

    def __init__(
        self,
        pid: int | None = None,
        key: str | None = None,
        notify_url: str | None = None,
        return_url: str | None = None,
        api_url: str | None = None,
    ) -> None:
        self.pid = pid if pid is not None else bill_settings.epay_pid
        self.key = key if key is not None else (bill_settings.epay_private_key or bill_settings.epay_public_key)
        self.notify_url = notify_url if notify_url is not None else bill_settings.epay_notify_url
        self.return_url = return_url if return_url is not None else bill_settings.epay_return_url
        resolved_api_url = api_url if api_url is not None else (bill_settings.epay_api_url or _FALLBACK_API_URL)
        self.api_url = resolved_api_url.rstrip("/")

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

    def query_order(self, order_no: str) -> ProviderQueryResult:
        """主动向上游网关查询订单支付结果。

        各易支付网关 ``api.php?act=order`` 响应契约不完全一致（字段名 money/status/
        trade_status 混用），因此只在能明确判定时返回 paid/unpaid/not_found，
        其余一律 unknown —— 调用方在 unknown 下不得迁移订单终态。
        """
        params = {
            "act": "order",
            "pid": self.pid,
            "out_trade_no": order_no,
        }
        params["sign"] = self.sign_params(params, self.key)
        params["sign_type"] = "MD5"
        try:
            with httpx.Client(timeout=5.0) as client:
                resp = client.get(
                    f"{self.api_url}/api.php",
                    params={k: v for k, v in params.items() if k != "act"},
                )
                if resp.status_code != 200:
                    return self._unknown_result(order_no, {"http_status": resp.status_code})
                try:
                    data = resp.json()
                except ValueError:
                    return self._unknown_result(order_no, {"body": resp.text[:500]})
        except Exception as exc:
            return self._unknown_result(order_no, {"error": repr(exc)})

        code = data.get("code")
        if code not in (0, 1, "0", "1"):
            # 网关返回业务错误码：-1 等通常代表订单不存在，但各网关语义不一，统一 not_found
            # 之外的错误（签名失败、系统异常）无法区分，保守返回 unknown。
            return self._unknown_result(order_no, data)
        if code in (0, "0"):
            return ProviderQueryResult(
                order_no=order_no,
                provider_trade_no=None,
                amount_fen=0,
                status="not_found",
                raw_data=data,
            )

        trade_status = str(data.get("trade_status") or data.get("status") or "").upper()
        provider_trade_no = data.get("trade_no")
        money = data.get("money")
        amount_fen = int(round(float(money) * 100)) if money is not None else 0

        if trade_status in ("TRADE_SUCCESS", "SUCCESS") or data.get("status") == 1:
            return ProviderQueryResult(
                order_no=order_no,
                provider_trade_no=str(provider_trade_no) if provider_trade_no else None,
                amount_fen=amount_fen,
                status="paid",
                raw_data=data,
            )
        if trade_status in ("TRADE_PENDING", "WAIT_BUYER_PAY", "UNPAY", "NOTPAY", "WAIT"):
            return ProviderQueryResult(
                order_no=order_no,
                provider_trade_no=str(provider_trade_no) if provider_trade_no else None,
                amount_fen=amount_fen,
                status="unpaid",
                raw_data=data,
            )
        return self._unknown_result(order_no, data)

    @staticmethod
    def _unknown_result(order_no: str, raw: dict[str, Any]) -> ProviderQueryResult:
        return ProviderQueryResult(
            order_no=order_no,
            provider_trade_no=None,
            amount_fen=0,
            status="unknown",
            raw_data=raw,
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
