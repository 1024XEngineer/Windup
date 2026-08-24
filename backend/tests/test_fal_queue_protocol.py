"""FAL 队列面的脱网单测。

响应体全部取自 2026-08-24 对网关的实测,不是构造出来的样例 —— 这一面有三处只在真响应里
才看得见:``/status`` 的 ``COMPLETED`` 不区分成败、取结果的 400 可能是"还没好"、
以及首帧字段名按端点族分两种。
"""
from __future__ import annotations

import base64
import io
from dataclasses import fields

import httpx
import pytest

from windup_common.enums.model import ModelErrorType
from windup_framework.gateway.types import AdapterResult
from windup_framework.providers.protocol import (
    FAL_I2V_ENDPOINTS,
    FalQueueVideoProtocol,
    OpenAIVideoProtocol,
    UnknownFalEndpointError,
    VideoRequest,
)
from windup_framework.providers.protocol.fal_queue import gateway_root, queue_prefix

KLING = "fal-ai/kling-video/o1/image-to-video"
SEEDANCE = "bytedance/seedance-2.0/image-to-video"
VEO = "fal-ai/veo3.1/image-to-video"
VIDU = "fal-ai/vidu/q1/image-to-video"

#: 配置里的 base_url 指向 OpenAI 面,``/queue`` 与 ``/v1`` 平级。
BASE_URL = "https://api.qnaigc.com/v1"
ROOT = "https://api.qnaigc.com"

REQUEST_ID = "qvideo-1382244847-1787504690896902712"

#: 建单实测响应(kling)。``status_url`` 是网关自己给出的轮询地址,下面用它校准重建规则。
SUBMIT_200 = {
    "status": "IN_QUEUE",
    "request_id": REQUEST_ID,
    "response_url": f"{ROOT}/queue/fal-ai/kling-video/requests/{REQUEST_ID}",
    "status_url": f"{ROOT}/queue/fal-ai/kling-video/requests/{REQUEST_ID}/status",
}

FETCH_200 = {"video": {"url": "https://cdn.invalid/x.mp4", "duration": 5,
                       "content_type": "video/mp4"}}
FETCH_500_VENDOR = {"detail": {"loc": ["body"], "msg": "Image pixel is invalid",
                               "type": "VENDOR_FAILED", "url": ""}}
FETCH_500_CREATE = {"detail": {
    "loc": ["body"],
    "msg": "provider task id not found: ... provider_error=File is not in a valid base64 format",
    "type": "RUNTIME_CREATE_PROVIDER_FAILED",
    "url": "",
}}
FETCH_400_PENDING = {"status": "IN_PROGRESS", "request_id": REQUEST_ID}


def _png(size: tuple[int, int] = (64, 64)) -> bytes:
    from PIL import Image

    buf = io.BytesIO()
    Image.new("RGBA", size, (200, 30, 30, 255)).save(buf, "PNG")
    return buf.getvalue()


def _req(model: str = "kling-video-o1") -> VideoRequest:
    return VideoRequest(
        model=model, prompt="向右走", seconds=5, size="1280x720", mode="std",
        first_frame=_png(),
    )


def _fal(endpoint: str = KLING, key: str = "k-123") -> FalQueueVideoProtocol:
    return FalQueueVideoProtocol(key, endpoint, base_url=BASE_URL)


def _populated(result: AdapterResult) -> set[str]:
    """取值不等于默认值的字段名 —— #332 第 10 节的"两面产出同构"就是比这个集合。"""
    return {f.name for f in fields(result) if getattr(result, f.name) != f.default}


# ── 建单 ────────────────────────────────────────────────────────────────────


def test_auth_header_is_key_not_bearer():
    """本面是 ``Key``;与 ``Bearer`` 互换后的 401 与"模型不存在"难以区分。"""
    fal = _fal().build_submit(_req())
    openai = OpenAIVideoProtocol("k-123").build_submit(_req())

    assert fal.headers["Authorization"] == "Key k-123"
    assert openai.headers["Authorization"] == "Bearer k-123"


def test_submit_path_keeps_the_queue_prefix_and_leaves_v1_behind():
    """少了 ``queue/`` 全部 404;而拿 ``.../v1`` 直接拼会拼出 ``/v1/queue/...``。"""
    call = _fal().build_submit(_req())

    assert call.method == "POST"
    assert call.path == f"{ROOT}/queue/{KLING}"
    assert "/v1/" not in call.path


def test_kling_o1_wants_start_image_url():
    body = _fal(KLING).build_submit(_req()).body

    assert "start_image_url" in body and "image_url" not in body


@pytest.mark.parametrize("endpoint", [SEEDANCE, VEO, VIDU])
def test_the_other_three_want_image_url(endpoint):
    body = _fal(endpoint).build_submit(_req()).body

    assert "image_url" in body and "start_image_url" not in body


def test_first_frame_is_a_jpeg_datauri():
    """四个端点都接受 dataURI(2026-08-24 实测),所以不需要 bytes → 公网 URL 的上传器。"""
    body = _fal().build_submit(_req()).body

    ref = body["start_image_url"]
    assert ref.startswith("data:image/jpeg;base64,")
    assert base64.b64decode(ref.split(",", 1)[1])[:2] == b"\xff\xd8"


def test_body_carries_no_model_field():
    """型号由端点路径表达,不是请求体里的一个字段。"""
    assert "model" not in _fal().build_submit(_req()).body


def test_seconds_does_not_reach_the_body_yet():
    """时长字段虽都叫 ``duration``,取值形态分 5 / "5" / "5s" 三种且未逐个实测。

    这一条钉住的是一个已知缺口:接进编排之前必须补测,否则 ``seconds`` 静默失效。
    """
    assert "duration" not in _fal().build_submit(_req(model="veo3.1")).body


def test_unregistered_endpoint_is_refused_at_construction():
    """猜中一条"存在但语义不同"的路径会正常出片、正常计费,所以不做前缀匹配。"""
    with pytest.raises(UnknownFalEndpointError, match="不在 FAL 图生视频端点表里"):
        _fal("fal-ai/kling-video/o1/reference-to-video")


def test_submit_response_without_request_id_is_invalid():
    """本面的单号叫 ``request_id``,不是 OpenAI 面那个 ``id``。"""
    fal = _fal()

    assert fal.parse_submit(httpx.Response(200, json=SUBMIT_200)).job_id == REQUEST_ID
    assert fal.parse_submit(
        httpx.Response(200, json={"id": "job-9"})
    ).error_type is ModelErrorType.INVALID_RESPONSE


@pytest.mark.parametrize(
    "detail", ["invalid or unsafe url", "start_image_url is required"]
)
def test_rejected_submit_opens_no_job(detail):
    """建单期的参数校验因端点而异,被拒时还没有单据,不能带着 job_id 回去。"""
    parsed = _fal().parse_submit(httpx.Response(400, json={"detail": detail}))

    assert not parsed.ok and parsed.http_status == 400
    assert parsed.job_id is None and not parsed.maybe_billed


def test_poll_404_keeps_the_job_id():
    """轮询失败要带着单号回去,否则重试会新开一单、二次计费。"""
    parsed = _fal().parse_poll(httpx.Response(404, text="not found"), REQUEST_ID)

    assert parsed.error_type is ModelErrorType.JOB_NOT_FOUND
    assert parsed.job_id == REQUEST_ID and parsed.maybe_billed


# ── 轮询 ────────────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    ("endpoint", "prefix"),
    [
        (KLING, "/queue/fal-ai/kling-video/requests/"),
        (SEEDANCE, "/queue/bytedance/seedance-2.0/requests/"),
        (VEO, "/queue/fal-ai/veo3.1/requests/"),
        (VIDU, "/queue/fal-ai/vidu/requests/"),
    ],
)
def test_poll_prefix_is_the_first_two_segments(endpoint, prefix):
    """单据地址丢掉建单路径的第三段起 —— 这些前缀是 2026-08-24 逐个实测到的。"""
    call = _fal(endpoint).build_poll(REQUEST_ID)

    assert call.path == f"{ROOT}{prefix}{REQUEST_ID}/status"
    assert call.method == "GET"


def test_rebuilt_poll_url_matches_what_the_gateway_handed_back():
    """重建规则的校准点:与建单响应里的 ``status_url`` / ``response_url`` 逐字节比对。"""
    fal = _fal(KLING)

    assert fal.build_poll(REQUEST_ID).path == SUBMIT_200["status_url"]
    assert fal.build_fetch(REQUEST_ID).path == SUBMIT_200["response_url"]


@pytest.mark.parametrize("status", ["IN_QUEUE", "IN_PROGRESS"])
def test_in_flight_poll_has_no_error_type(status):
    """adapter 靠"没有 error_type"判定该继续轮询。"""
    parsed = _fal().parse_poll(httpx.Response(200, json={"status": status}), REQUEST_ID)

    assert parsed.error_type is None and not parsed.ok
    assert parsed.job_status == status


def test_completed_poll_stops_polling_without_claiming_success():
    """``COMPLETED`` 不是成功信号:成败要等取结果。所以这一步不给 ``result_url``。"""
    parsed = _fal().parse_poll(httpx.Response(200, json={"status": "COMPLETED"}), REQUEST_ID)

    assert parsed.ok and parsed.result_url is None
    assert _fal().build_fetch(REQUEST_ID) is not None, "本面必须真去取一次结果"


def test_unrecognised_poll_status_is_a_failure_not_a_wait():
    """继续轮询会把"协议变了"伪装成"生成太慢",转满预算才报超时。"""
    parsed = _fal().parse_poll(httpx.Response(200, json={"status": "FAILED"}), REQUEST_ID)

    assert parsed.error_type is ModelErrorType.UPSTREAM_FAILED
    assert parsed.job_id == REQUEST_ID and parsed.maybe_billed


# ── 取结果 ──────────────────────────────────────────────────────────────────


def test_fetch_200_hands_back_the_video_url():
    parsed = _fal().parse_fetch(httpx.Response(200, json=FETCH_200), REQUEST_ID)

    assert parsed.ok and parsed.result_url == "https://cdn.invalid/x.mp4"
    assert parsed.job_status == "COMPLETED"


def test_fetch_also_reads_a_url_nested_under_result():
    """只认一处而对面给的是另一处,丢掉的是一段已生成、已付费的视频。"""
    parsed = _fal().parse_fetch(
        httpx.Response(200, json={"result": FETCH_200}), REQUEST_ID
    )

    assert parsed.ok and parsed.result_url == "https://cdn.invalid/x.mp4"


def test_fetch_2xx_without_a_url_is_invalid_not_ok():
    parsed = _fal().parse_fetch(httpx.Response(200, json={"video": {}}), REQUEST_ID)

    assert not parsed.ok and parsed.error_type is ModelErrorType.INVALID_RESPONSE


@pytest.mark.parametrize(
    ("payload", "kind", "msg"),
    [
        (FETCH_500_VENDOR, "VENDOR_FAILED", "Image pixel is invalid"),
        (FETCH_500_CREATE, "RUNTIME_CREATE_PROVIDER_FAILED", "not in a valid base64 format"),
    ],
)
def test_completed_but_fetch_500_is_a_failure(payload, kind, msg):
    """``/status`` 说 COMPLETED、取结果却 500 —— 成败只有这一步分得开。"""
    fal = _fal()
    assert fal.parse_poll(httpx.Response(200, json={"status": "COMPLETED"}), REQUEST_ID).ok

    parsed = fal.parse_fetch(httpx.Response(500, json=payload), REQUEST_ID)

    assert parsed.error_type is ModelErrorType.UPSTREAM_FAILED
    assert parsed.maybe_billed and parsed.job_id == REQUEST_ID
    assert parsed.job_status == kind, "网关自己的失败分类比恒为 COMPLETED 的状态值值钱"
    assert msg in parsed.edge_fingerprint


def test_fetch_400_in_progress_is_not_ready_rather_than_a_client_error():
    """veo3.1 与 vidu 未就绪时实测返回 400 —— 按客户端错误处理会把在跑的任务判死。"""
    parsed = _fal(VEO).parse_fetch(httpx.Response(400, json=FETCH_400_PENDING), REQUEST_ID)

    assert parsed.error_type is None and not parsed.ok
    assert parsed.job_status == "IN_PROGRESS" and parsed.job_id == REQUEST_ID


def test_a_real_400_is_still_a_400():
    """未就绪那条不能宽到把真的参数错也放过。"""
    parsed = _fal().parse_fetch(
        httpx.Response(400, json={"detail": "invalid or unsafe url"}), REQUEST_ID
    )

    assert parsed.error_type is not None and parsed.http_status == 400


def test_fetch_500_without_detail_falls_back_to_the_http_classifier():
    parsed = _fal().parse_fetch(httpx.Response(500, text="<html>bad gateway"), REQUEST_ID)

    assert parsed.error_type is ModelErrorType.MAYBE_BILLED and parsed.maybe_billed


# ── 两面同构(#332 第 10 节)─────────────────────────────────────────────────


def test_both_faces_report_a_submitted_job_the_same_way():
    fal = _fal().parse_submit(httpx.Response(200, json=SUBMIT_200))
    openai = OpenAIVideoProtocol("k").parse_submit(httpx.Response(200, json={"id": "job-9"}))

    assert _populated(fal) == _populated(openai)
    assert fal.ok and openai.ok


def test_both_faces_report_a_job_still_running_the_same_way():
    fal = _fal().parse_poll(httpx.Response(200, json={"status": "IN_PROGRESS"}), "j")
    pending_at_fetch = _fal(VEO).parse_fetch(
        httpx.Response(400, json=FETCH_400_PENDING), "j"
    )
    openai = OpenAIVideoProtocol("k").parse_poll(
        httpx.Response(200, json={"status": "processing"}), "j"
    )

    assert _populated(fal) == _populated(openai) == _populated(pending_at_fetch)


def test_both_faces_report_a_finished_video_the_same_way():
    """一面的产物地址来自轮询、另一面来自取结果,交回给 adapter 的形状必须一致。"""
    fal = _fal().parse_fetch(httpx.Response(200, json=FETCH_200), "j")
    openai = OpenAIVideoProtocol("k").parse_poll(
        httpx.Response(
            200,
            json={"status": "completed",
                  "task_result": {"videos": [{"url": "https://cdn.invalid/x.mp4"}]}},
        ),
        "j",
    )

    assert _populated(fal) == _populated(openai)
    assert fal.result_url == openai.result_url


# ── 两个纯函数 ──────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    ("base", "expected"),
    [
        ("https://api.qnaigc.com/v1", ROOT),
        ("https://api.qnaigc.com/v1/", ROOT),
        ("https://api.qnaigc.com", ROOT),
        ("https://api.qnaigc.com/gw/v1", "https://api.qnaigc.com/gw"),
    ],
)
def test_gateway_root_strips_the_openai_face(base, expected):
    assert gateway_root(base) == expected


def test_queue_prefix_covers_every_registered_endpoint():
    """表里每一条都必须能被规则算出前两段,新登记一条时这里会先红。"""
    for endpoint in FAL_I2V_ENDPOINTS:
        assert queue_prefix(endpoint).count("/") == 1


@pytest.mark.parametrize("body", ["[1, 2]", '"just a string"', "null", "17"])
def test_a_2xx_that_is_not_a_json_object_is_invalid_not_a_crash(body):
    """2xx 下返回合法但非对象的 JSON,要收成 INVALID_RESPONSE 而不是抛 AttributeError。

    抛出去的话请求以未处理异常结束,Gateway 拿不到可判的结果,而单据可能已经建了。
    """
    p = _fal()
    resp = httpx.Response(200, content=body, headers={"content-type": "application/json"})

    assert p.parse_submit(resp).error_type is ModelErrorType.INVALID_RESPONSE
    assert p.parse_poll(resp, "job-9").error_type is ModelErrorType.INVALID_RESPONSE
