"""业务异常基类。

领域代码 ``raise BizException(...)`` 抛出,由全局异常处理器
(``windup_app.web.handler.exception_handlers``)统一转成 ``Response.fail`` 返回前端。

签名刻意对齐 :meth:`windup_common.result.Response.fail`,
让 ``raise`` 与响应一一对应::

    raise BizException("用户不存在", code=BizCode.NOT_FOUND)
    # -> 前端收到 {"code": 404, "message": "用户不存在", "data": null}
"""

from windup_common.enums.biz_code import BizCode


class BizException(Exception):
    """业务异常。

    - ``message``:提示信息,默认 ``"业务异常"``。
    - ``code``:业务状态码,默认 :attr:`BizCode.INTERNAL_ERROR` (500,与 ``Response.fail`` 一致)。
    - ``data``:可选的错误明细,默认 ``None``。
    """

    def __init__(
        self,
        message: str = "业务异常",
        *,
        code: int = BizCode.INTERNAL_ERROR,
        data: object = None,
    ) -> None:
        self.message = message
        self.code = code
        self.data = data
        super().__init__(message)
