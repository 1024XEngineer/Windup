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
    UNREACHED = "unreached"                 # 521/522/523/525,请求大概率未到上游
    MAYBE_BILLED = "maybe_billed"           # 520/524/其它可能已计费 5xx
    UPSTREAM_FAILED = "upstream_failed"     # 视频 job failed/cancelled
    MODEL_NOT_FOUND = "model_not_found"     # 404 模型不存在 → fallback model
    CONFIG_ERROR = "config_error"             # 404/400 路径或 endpoint 配错 → fail fast
    JOB_NOT_FOUND = "job_not_found"           # 异步 poll job 404 → 任务失败
    UNKNOWN = "unknown"                     # 未知错误

    @property
    def retryable(self) -> bool:
        """是否建议重试。"""
        return self in {
            ModelErrorType.RATE_LIMIT,
            ModelErrorType.TIMEOUT,
            ModelErrorType.NETWORK,
            ModelErrorType.UNREACHED,
        }
