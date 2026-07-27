"""全局异常处理器:把异常统一转成 ``Response`` 返回前端。

挂载入口 :func:`register_exception_handlers`,在 ``create_app`` 中调用。

约定:所有异常均返回 **HTTP 200**,业务码放 body(符合"统一返回");
未预期异常用 ``logger.error(..., exc_info=exc)`` 记录完整堆栈到日志,方便后端排查。
业务码统一引用 :class:`windup_common.enums.biz_code.BizCode`。
"""

import logging

from fastapi import FastAPI, HTTPException, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from windup_common.enums.biz_code import BizCode
from windup_common.exceptions import BizException
from windup_common.result import Response

logger = logging.getLogger("windup.handler")


def _jsonify(resp: Response, status_code: int = 200) -> JSONResponse:
    """把 ``Response`` 包成 ``JSONResponse``(默认 HTTP 200,业务码在 body)。"""
    return JSONResponse(status_code=status_code, content=resp.model_dump(mode="json"))


def handle_biz_exception(request: Request, exc: BizException) -> JSONResponse:
    """业务异常 -> ``Response.fail``,字段与 ``BizException`` 一一对应。"""
    return _jsonify(Response.fail(exc.message, code=exc.code, data=exc.data))


def handle_request_validation_error(
    request: Request, exc: RequestValidationError
) -> JSONResponse:
    """请求参数校验失败(FastAPI 默认 422)-> ``code=BizCode.BAD_REQUEST``,data 带校验明细。

    ``exc.errors()`` 的 ``ctx`` 可能含不可 JSON 序列化的对象(如 ``ValueError``),
    过一道 ``jsonable_encoder`` 保险。
    """
    return _jsonify(
        Response.fail(
            "请求参数校验失败",
            code=BizCode.BAD_REQUEST,
            data=jsonable_encoder(exc.errors()),
        )
    )


def handle_http_exception(request: Request, exc: HTTPException) -> JSONResponse:
    """FastAPI ``HTTPException`` -> 业务码取 ``status_code``,message 取 ``detail``。"""
    return _jsonify(Response.fail(str(exc.detail), code=exc.status_code))


def handle_unhandled_exception(request: Request, exc: Exception) -> JSONResponse:
    """兜底:未预期异常 -> ``code=BizCode.INTERNAL_ERROR``,记录完整堆栈供后端排查。

    用 ``exc_info=exc`` 显式传异常实例,而非 ``logger.exception`` 依赖
    ``sys.exc_info()``--sync 处理器可能被线程池调用,子线程里 ``sys.exc_info()``
    为空会丢掉堆栈;传实例则始终带上 ``exc.__traceback__``。
    """
    logger.error(
        "未预期异常  %s %s",
        request.method,
        request.url.path,
        exc_info=exc,
    )
    return _jsonify(Response.fail("服务器内部错误", code=BizCode.INTERNAL_ERROR))


def register_exception_handlers(app: FastAPI) -> None:
    """注册全局异常处理器到 ``app``。

    注册顺序无关,FastAPI 按异常类型最具体匹配;
    ``Exception`` 作为兜底,捕获所有未被上面三类覆盖的异常。
    """
    app.add_exception_handler(BizException, handle_biz_exception)
    app.add_exception_handler(RequestValidationError, handle_request_validation_error)
    app.add_exception_handler(HTTPException, handle_http_exception)
    app.add_exception_handler(Exception, handle_unhandled_exception)
