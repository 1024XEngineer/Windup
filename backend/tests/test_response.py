"""统一响应封装 ``Response`` 的单元测试。"""

from datetime import datetime, timezone

from pydantic import BaseModel

from windup_common.result import Response


class _User(BaseModel):
    """测试用业务模型。"""

    id: int
    name: str


def test_success_defaults():
    """success() 无参:code=200、message=success、data/timestamp 为 None。"""
    resp = Response.success()
    assert resp.code == 200
    assert resp.message == "success"
    assert resp.data is None
    assert resp.timestamp is None


def test_success_with_data():
    """success(data) 携带业务数据。"""
    resp = Response.success({"id": 1, "name": "windup"})
    assert resp.code == 200
    assert resp.data == {"id": 1, "name": "windup"}


def test_success_custom_message_and_code():
    """success 可覆盖 message / code。"""
    resp = Response.success(True, message="created", code=201)
    assert resp.code == 201
    assert resp.message == "created"
    assert resp.data is True


def test_fail_defaults():
    """fail() 无参:code=500、message=fail、data/timestamp 为 None。"""
    resp = Response.fail()
    assert resp.code == 500
    assert resp.message == "fail"
    assert resp.data is None
    assert resp.timestamp is None


def test_fail_with_message_and_code():
    """fail(message, code=...) 覆盖默认。"""
    resp = Response.fail("用户不存在", code=404)
    assert resp.code == 404
    assert resp.message == "用户不存在"


def test_fail_can_carry_data():
    """fail 也可携带错误明细。"""
    resp = Response.fail("校验失败", code=400, data={"field": "email"})
    assert resp.data == {"field": "email"}


def test_timestamp_optional():
    """时间戳可带可不带;带时原样保留。"""
    without_ts = Response.success("ok")
    assert without_ts.timestamp is None

    now = datetime(2026, 7, 25, 9, 30, tzinfo=timezone.utc)
    with_ts = Response.success("ok", timestamp=now)
    assert with_ts.timestamp == now


def test_generic_data_validated():
    """Response[_User] 参数化后,data 被约束并校验为 _User。"""
    resp = Response[_User].success({"id": 1, "name": "windup"})
    assert isinstance(resp.data, _User)
    assert resp.data.id == 1
    assert resp.data.name == "windup"


def test_serialization_has_all_fields_when_timestamp_set():
    """带 timestamp 时,序列化输出含 code/message/data/timestamp 四个字段。"""
    now = datetime(2026, 7, 25, 9, 30, tzinfo=timezone.utc)
    resp = Response.success({"ok": True}, timestamp=now)
    dumped = resp.model_dump(mode="json")
    assert set(dumped) == {"code", "message", "data", "timestamp"}
    assert dumped["code"] == 200
    assert dumped["data"] == {"ok": True}
    assert dumped["timestamp"] == "2026-07-25T09:30:00Z"


def test_timestamp_omitted_when_none():
    """不传 timestamp 时,输出里没有 timestamp 键(而非 null)。"""
    resp = Response.success("ok")
    dumped = resp.model_dump(mode="json")
    assert "timestamp" not in dumped
    assert set(dumped) == {"code", "message", "data"}


def test_data_none_kept_as_null():
    """data 为 None 时仍保留为 null;timestamp 省略不影响 data。"""
    resp = Response.fail("boom")
    dumped = resp.model_dump(mode="json")
    assert "data" in dumped
    assert dumped["data"] is None
    assert "timestamp" not in dumped
