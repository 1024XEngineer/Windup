"""ListResponse 测试。"""

from datetime import datetime

import pytest
from pydantic import ValidationError

from windup_common.enums.biz_code import BizCode
from windup_common.result import ListResponse


def test_success_default_empty_list():
    """success() 无参:data=[]、total=0(len)、page=1、page_size=0(不分页)。"""
    resp = ListResponse.success()
    assert resp.code == 200
    assert resp.message == "success"
    assert resp.data == []
    assert resp.total == 0
    assert resp.page == 1
    assert resp.page_size == 0
    assert resp.timestamp is None


def test_success_total_defaults_to_len():
    """不传 total 时,total 默认 = len(data)(全量场景)。"""
    resp = ListResponse.success([1, 2, 3])
    assert resp.data == [1, 2, 3]
    assert resp.total == 3
    assert resp.page_size == 0  # 不分页


def test_success_with_pagination():
    """分页场景:显式传 total/page/page_size;total 不被 len 覆盖。"""
    resp = ListResponse.success([1, 2], total=42, page=2, page_size=20)
    assert resp.data == [1, 2]
    assert resp.total == 42
    assert resp.page == 2
    assert resp.page_size == 20


def test_success_none_data_becomes_empty():
    """显式传 None 也得到空列表,total=0。"""
    resp = ListResponse.success(None)
    assert resp.data == []
    assert resp.total == 0


def test_fail_default():
    """fail() 无参:code=500、message=fail、data=[]、分页字段默认。"""
    resp = ListResponse.fail()
    assert resp.code == 500
    assert resp.message == "fail"
    assert resp.data == []
    assert resp.total == 0
    assert resp.page == 1
    assert resp.page_size == 0


def test_fail_with_data():
    """fail 可携带列表数据。"""
    resp = ListResponse.fail("查询失败", data=[{"id": 1}])
    assert resp.code == 500
    assert resp.data == [{"id": 1}]


def test_timestamp_omitted_when_none():
    """不传 timestamp:序列化结果无 timestamp 键;分页字段保留。"""
    dumped = ListResponse.success([1], total=5, page=1, page_size=20).model_dump(mode="json")
    assert set(dumped) == {"code", "message", "data", "total", "page", "page_size"}
    assert dumped["data"] == [1]
    assert dumped["total"] == 5


def test_timestamp_present_when_set():
    """传 timestamp:序列化结果含 timestamp。"""
    ts = datetime(2026, 7, 25, 12, 0, 0)
    dumped = ListResponse.success([1], timestamp=ts).model_dump(mode="json")
    assert "timestamp" in dumped
    assert dumped["timestamp"] == ts.isoformat()


def test_empty_list_serializes_to_empty_array_not_null():
    """空列表序列化为 [],而非 null。"""
    dumped = ListResponse.success().model_dump(mode="json")
    assert dumped["data"] == []
    assert dumped["data"] is not None


def test_pagination_fields_always_present():
    """分页字段始终出现在输出(全量 page_size=0 也输出)。"""
    dumped = ListResponse.success([1, 2]).model_dump(mode="json")
    assert dumped["total"] == 2
    assert dumped["page"] == 1
    assert dumped["page_size"] == 0


def test_generic_validates_element_type():
    """ListResponse[int] 会校验元素类型:传非 int 抛 ValidationError。"""
    with pytest.raises(ValidationError):
        ListResponse[int](data=["not_an_int"])


def test_page_must_be_positive():
    """page < 1 抛 ValidationError(ge=1 约束)。"""
    with pytest.raises(ValidationError):
        ListResponse[int](data=[], page=0)


def test_custom_code_via_biz_code():
    """code 可用 BizCode 覆盖(与 Response 对齐)。"""
    resp = ListResponse.fail("不存在", code=BizCode.NOT_FOUND)
    assert resp.code == 404
