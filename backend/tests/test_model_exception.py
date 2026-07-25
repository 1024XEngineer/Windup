"""大模型调用异常 ModelException 的单元 + 集成测试。"""

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from windup_app.web.handler.exception_handlers import register_exception_handlers
from windup_common.enums import ModelErrorType
from windup_common.exceptions import BizException, ModelException


def test_model_exception_is_biz_exception():
    """ModelException 是 BizException 子类,会被全局处理器按 MRO 捕获。"""
    assert issubclass(ModelException, BizException)


def test_defaults():
    """默认:message=模型调用失败、code=503、error_type=UNKNOWN、provider/model 为 None。"""
    exc = ModelException()
    assert exc.message == "模型调用失败"
    assert exc.code == 503
    assert exc.error_type is ModelErrorType.UNKNOWN
    assert exc.provider is None
    assert exc.model is None
    assert exc.data is None


def test_custom_fields():
    """自定义字段全部保留。"""
    exc = ModelException(
        "限流,请稍后重试",
        code=429,
        provider="qwen",
        model="qwen-max",
        error_type=ModelErrorType.RATE_LIMIT,
        data={"retry_after": 30},
    )
    assert exc.message == "限流,请稍后重试"
    assert exc.code == 429
    assert exc.provider == "qwen"
    assert exc.model == "qwen-max"
    assert exc.error_type is ModelErrorType.RATE_LIMIT
    assert exc.data == {"retry_after": 30}


def test_error_type_retryable():
    """限流/超时/网络错误可重试;鉴权/无效响应/未知不可重试。"""
    assert ModelErrorType.RATE_LIMIT.retryable is True
    assert ModelErrorType.TIMEOUT.retryable is True
    assert ModelErrorType.NETWORK.retryable is True
    assert ModelErrorType.AUTH.retryable is False
    assert ModelErrorType.INVALID_RESPONSE.retryable is False
    assert ModelErrorType.UNKNOWN.retryable is False


def test_cause_chaining():
    """raise ... from 底层异常,__cause__ 正确链上。"""
    underlying = TimeoutError("read timeout")
    with pytest.raises(ModelException) as exc_info:
        raise ModelException(
            "模型超时", error_type=ModelErrorType.TIMEOUT, model="qwen-max"
        ) from underlying
    assert exc_info.value.__cause__ is underlying


def test_model_exception_caught_by_global_handler():
    """raise ModelException -> 全局 BizException 处理器按 MRO 捕获 -> HTTP 200 + 统一 body。"""
    app = FastAPI()

    @app.get("/model")
    def model():
        raise ModelException("模型限流", code=429, error_type=ModelErrorType.RATE_LIMIT)

    register_exception_handlers(app)
    client = TestClient(app, raise_server_exceptions=False)

    r = client.get("/model")
    assert r.status_code == 200
    body = r.json()
    assert body["code"] == 429
    assert body["message"] == "模型限流"
    assert body["data"] is None
    assert "timestamp" not in body
