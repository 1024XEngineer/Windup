"""网关对外抛的异常。

单独一个模块而不是散在各 gateway 文件里:调用方要 ``except`` 它,而 ``chat`` / ``image``
/ ``video`` 互不 import,放在其中任何一个都会让另外两个的调用方去 import 一条无关的面。
"""

from __future__ import annotations

from windup_common.enums.model import ModelErrorType

__all__ = ["UpstreamExhaustedError"]


class UpstreamExhaustedError(RuntimeError):
    """一次请求的重试与兜底都用完了。

    带上 ``error_type`` 与 ``maybe_billed``,是为了让调用方能分开两件性质完全不同的事:

    - **这次白跑了**(限流被拒、根本没到上游):没有消耗任何配额,整条任务可以过一会儿
      再来一遍,判失败等于凭空丢掉一个本来能成的任务。
    - **这次可能已计费**:再来一遍就是再花一次钱,只能判失败。

    过去这里抛的是裸 ``RuntimeError``,类型只出现在消息字符串里 —— 调用方要么去
    ``in`` 匹配文案(改一次文案就静默失效),要么一律当失败(就是现在的样子)。

    继承 ``RuntimeError`` 是为了向后兼容:既有的 ``except RuntimeError`` / ``except
    Exception`` 一个都不用改。
    """

    def __init__(
        self,
        message: str,
        *,
        error_type: ModelErrorType | None = None,
        maybe_billed: bool = False,
    ) -> None:
        super().__init__(message)
        self.error_type = error_type
        self.maybe_billed = maybe_billed

    @property
    def is_free_retryable(self) -> bool:
        """这次失败没有消耗任何配额,原样重投是安全的。"""
        return (
            self.error_type is ModelErrorType.RATE_LIMIT and not self.maybe_billed
        )
