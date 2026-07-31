"""大模型相关枚举。

当前含 :class:`ModelErrorType`:大模型调用失败的具体分类,供
``windup_ai_engine`` 模型适配器及上层在调用失败时归类、决定是否重试。
"""

from enum import Enum


class ModelErrorType(str, Enum):
    """大模型调用失败的具体类型。"""

    RATE_LIMIT = "rate_limit"               # 限流(429),可重试
    TIMEOUT = "timeout"                     # 请求超时,可重试
    NETWORK = "network"                     # 网络错误(连接失败 / DNS),可重试
    AUTH = "auth"                           # 鉴权失败(密钥错 / 失效),不可重试
    INVALID_RESPONSE = "invalid_response"   # 返回格式错误(如该出图却返回纯文本 / 空)
    UNKNOWN = "unknown"                     # 未知错误

    @property
    def retryable(self) -> bool:
        """是否建议重试。"""
        return self in {
            ModelErrorType.RATE_LIMIT,
            ModelErrorType.TIMEOUT,
            ModelErrorType.NETWORK,
        }
