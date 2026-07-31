"""大模型调用异常。

放在 ``windup_common`` 共享内核(所有包都依赖它),供 ``windup_ai_engine`` 模型适配器
及任何上层在调用大模型(OpenAI / 通义 / Gemini 等)失败时 raise。继承
:class:`windup_common.exceptions.biz.BizException`,会被 ``windup_app.web`` 全局
``BizException`` 处理器按 MRO 自动捕获,统一转成 ``Response.fail`` 返回前端。

错误分类 :class:`windup_common.enums.model.ModelErrorType` 供上层
(server / ai_engine 内部)决定是否重试:限流 / 超时 / 网络错误可重试,鉴权失败不可重试。

用法::

    try:
        resp = client.chat.completions.create(...)
    except TimeoutError as exc:
        raise ModelException(
            "模型超时", provider="qwen", model="qwen-max",
            error_type=ModelErrorType.TIMEOUT,
        ) from exc
"""

from windup_common.enums.biz_code import BizCode
from windup_common.enums.model import ModelErrorType
from windup_common.exceptions.biz import BizException


class ModelException(BizException):
    """大模型调用异常。

    继承 ``BizException``:``message`` / ``code`` / ``data`` 经全局处理器进响应体;
    额外的 ``provider`` / ``model`` / ``error_type`` 供内部日志与重试决策,
    不直接出现在前端响应里(如需给前端更多上下文,显式传 ``data=...``)。

    - ``message``:默认 ``"模型调用失败"``。
    - ``code``:默认 :attr:`BizCode.MODEL_UNAVAILABLE` (503,模型服务不可用)。
    - ``provider`` / ``model``:出错的供应商 / 模型名(如 ``"qwen"`` / ``"qwen-max"``)。
    - ``error_type``:错误分类,默认 :attr:`ModelErrorType.UNKNOWN`。

    底层异常用 ``raise ModelException(...) from exc`` 链上,``__cause__`` 自动设置。
    """

    def __init__(
        self,
        message: str = "模型调用失败",
        *,
        code: int = BizCode.MODEL_UNAVAILABLE,
        data: object = None,
        provider: str | None = None,
        model: str | None = None,
        error_type: ModelErrorType = ModelErrorType.UNKNOWN,
    ) -> None:
        super().__init__(message, code=code, data=data)
        self.provider = provider
        self.model = model
        self.error_type = error_type
