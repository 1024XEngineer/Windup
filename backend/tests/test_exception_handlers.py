"""全局异常处理器的端到端测试。

自建 mini FastAPI app 注册处理器 + 几条故意 raise 的路由,用 TestClient 验证
四类异常都返回 HTTP 200 + 统一 Response body。

``raise_server_exceptions=False``:兜底路由故意抛未预期异常,关闭 TestClient
对服务端异常的透传,以便断言处理器返回的 200 响应(而非被 re-raise 拦下)。
"""

import logging

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from pydantic import BaseModel

from windup_app.web.handler.exception_handlers import register_exception_handlers
from windup_common.exceptions import BizException


class _CreateUser(BaseModel):
    name: str
    age: int


def _build_app() -> FastAPI:
    app = FastAPI()

    @app.get("/biz")
    def biz():
        raise BizException("用户不存在", code=404)

    @app.post("/validation")
    def validation(body: _CreateUser):
        return body

    @app.get("/http")
    def http_exc():
        raise HTTPException(status_code=403, detail="禁止访问")

    @app.get("/boom")
    def boom():
        raise RuntimeError("boom")

    register_exception_handlers(app)
    return app


client = TestClient(_build_app(), raise_server_exceptions=False)


def test_biz_exception_returns_200_with_business_code():
    """业务异常 -> HTTP 200,body code/message 对应 BizException,data 为 null。"""
    r = client.get("/biz")
    assert r.status_code == 200
    body = r.json()
    assert body["code"] == 404
    assert body["message"] == "用户不存在"
    assert body["data"] is None
    assert "timestamp" not in body


def test_request_validation_error_returns_200_with_errors():
    """参数校验失败(FastAPI 默认 422)-> HTTP 200,code=400,data 带错误明细。"""
    r = client.post("/validation", json={"name": "windup"})  # 缺 age
    assert r.status_code == 200
    body = r.json()
    assert body["code"] == 400
    assert "校验失败" in body["message"]
    assert isinstance(body["data"], list)
    assert len(body["data"]) > 0


def test_http_exception_mapped_to_response():
    """FastAPI HTTPException -> code=status_code,message=detail。"""
    r = client.get("/http")
    assert r.status_code == 200
    body = r.json()
    assert body["code"] == 403
    assert body["message"] == "禁止访问"


def test_unhandled_exception_returns_500_business_code_and_logs(caplog):
    """未预期异常 -> HTTP 200,body code=500,且 ERROR 日志带堆栈。"""
    with caplog.at_level(logging.ERROR, logger="windup_app.web.handler.exception_handlers"):
        r = client.get("/boom")
    assert r.status_code == 200
    body = r.json()
    assert body["code"] == 500
    assert body["message"] == "服务器内部错误"

    error_records = [rec for rec in caplog.records if rec.levelno == logging.ERROR]
    assert error_records, "应记录 ERROR 日志"
    assert any("未预期异常" in rec.getMessage() for rec in error_records)
    assert any(rec.exc_info is not None for rec in error_records), "日志应带异常堆栈"
