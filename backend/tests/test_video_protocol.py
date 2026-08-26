"""协议层脱网单测。

协议只产出纯数据,所以这一层不需要网络也不需要打桩 —— 断言的是"字节怎么排",
不是"发出去会怎样"。
"""
from __future__ import annotations

import base64
import io

import httpx
import pytest

from windup_common.enums.model import ModelErrorType
from windup_framework.providers.protocol import OpenAIVideoProtocol, VideoRequest
from windup_framework.providers.protocol.openai_video import IMAGE_LIST_MODELS


def _png(size: tuple[int, int] = (64, 64)) -> bytes:
    from PIL import Image

    buf = io.BytesIO()
    Image.new("RGBA", size, (200, 30, 30, 255)).save(buf, "PNG")
    return buf.getvalue()


def _req(model: str = "kling-v2-5-turbo") -> VideoRequest:
    return VideoRequest(
        model=model, prompt="向右走", seconds=5, size="1280x720", mode="std",
        first_frame=_png(),
    )


def test_submit_is_a_post_to_videos_with_bearer():
    """鉴权头由协议层产出:Key 与 Bearer 互换后的响应与"模型不存在"难以区分。"""
    call = OpenAIVideoProtocol("k-123").build_submit(_req())

    assert (call.method, call.path) == ("POST", "/videos")
    assert call.headers["Authorization"] == "Bearer k-123"
    assert call.body["seconds"] == "5", "seconds 是字符串,不是整数"
    assert call.body["mode"] == "std"


def test_first_frame_becomes_a_jpeg_data_uri():
    """PNG base64 实测会 VENDOR_FAILED,所以这一层必须转成 JPG。"""
    body = OpenAIVideoProtocol("k").build_submit(_req()).body

    assert "image_list" not in body
    ref = body["input_reference"]
    assert ref.startswith("data:image/jpeg;base64,")
    raw = base64.b64decode(ref.split(",", 1)[1])
    assert raw[:2] == b"\xff\xd8", "解出来必须是 JPEG"


def test_image_list_model_gets_bare_base64():
    """kling-video-o1 吃 image_list 且不带 data URI 前缀;塞错字段任务会 failed。"""
    body = OpenAIVideoProtocol("k").build_submit(_req(IMAGE_LIST_MODELS[0])).body

    assert "input_reference" not in body
    assert not body["image_list"][0]["image"].startswith("data:")


def test_submit_response_without_id_is_invalid_not_ok():
    """2xx 但没有单号不能当建单成功:后面轮询没有可跟的对象,而费用可能已产生。"""
    p = OpenAIVideoProtocol("k")

    assert p.parse_submit(httpx.Response(200, json={"id": "job-9"})).job_id == "job-9"
    assert p.parse_submit(httpx.Response(200, json={})).error_type is ModelErrorType.INVALID_RESPONSE
    assert p.parse_submit(httpx.Response(200, text="<html>")).error_type is ModelErrorType.INVALID_RESPONSE


def test_pending_poll_has_no_error_type():
    """adapter 靠"没有 error_type"判定该继续轮询,这条是两层之间的契约。"""
    parsed = OpenAIVideoProtocol("k").parse_poll(
        httpx.Response(200, json={"status": "processing"}), "job-9"
    )

    assert parsed.error_type is None and not parsed.ok
    assert parsed.job_status == "processing"


def test_completed_poll_hands_back_the_url():
    parsed = OpenAIVideoProtocol("k").parse_poll(
        httpx.Response(200, json={"status": "completed",
                                  "task_result": {"videos": [{"url": "https://cdn/x.mp4"}]}}),
        "job-9",
    )

    assert parsed.ok and parsed.result_url == "https://cdn/x.mp4"


def test_completed_without_video_is_not_a_url():
    """完成但没给地址,不能拿 None 当地址往下走。"""
    parsed = OpenAIVideoProtocol("k").parse_poll(
        httpx.Response(200, json={"status": "completed", "task_result": {}}), "job-9"
    )

    assert parsed.ok and parsed.result_url is None


@pytest.mark.parametrize("status", ["failed", "cancelled"])
def test_upstream_failure_is_billed(status):
    """单据已建,上游自己失败仍可能计费。"""
    parsed = OpenAIVideoProtocol("k").parse_poll(
        httpx.Response(200, json={"status": status, "error": "boom"}), "job-9"
    )

    assert parsed.error_type is ModelErrorType.UPSTREAM_FAILED
    assert parsed.maybe_billed and parsed.job_status == status
    assert "boom" in parsed.edge_fingerprint


def test_poll_http_error_keeps_the_job_id_and_the_edge():
    """轮询失败要带着单号回去,否则重试会新开一单、二次计费。"""
    parsed = OpenAIVideoProtocol("k").parse_poll(
        httpx.Response(500, text="oops", headers={"cf-ray": "r1", "server": "cf"}), "job-9"
    )

    assert parsed.job_id == "job-9" and parsed.maybe_billed
    assert "cf-ray=r1" in parsed.edge_fingerprint


def test_fetch_is_none_because_the_url_is_already_in_the_poll():
    """本面不需要第三步取结果;返回 None 而不是一个空 HttpCall,免得 adapter 真去发它。"""
    assert OpenAIVideoProtocol("k").build_fetch("job-9") is None


def test_poll_path_carries_the_job_id():
    call = OpenAIVideoProtocol("k").build_poll("job-9")

    assert (call.method, call.path) == ("GET", "/videos/job-9")
    assert call.headers["Authorization"] == "Bearer k"


@pytest.mark.parametrize("body", ["[1, 2]", '"just a string"', "null"])
def test_a_2xx_that_is_not_a_json_object_is_invalid_not_a_crash(body):
    """同队列面:2xx 下的非对象 JSON 要收成 INVALID_RESPONSE,不能抛 AttributeError。"""
    p = OpenAIVideoProtocol("k")
    resp = httpx.Response(200, content=body, headers={"content-type": "application/json"})

    assert p.parse_submit(resp).error_type is ModelErrorType.INVALID_RESPONSE
    assert p.parse_poll(resp, "job-9").error_type is ModelErrorType.INVALID_RESPONSE
