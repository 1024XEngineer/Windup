import io
import json

import httpx
import pytest

from windup_common.enums.model import ModelErrorType
from windup_framework.config.provider import AIProviderSettings
from windup_framework.providers.protocol.agnes_video import AgnesVideoProtocol
from windup_framework.providers.protocol.types import VideoRequest
from windup_framework.providers.sufy import SufyVideoProvider


MODEL = "agnes-video-2.5"
PUBLIC_FRAME = "https://media.windup.xin/i2v/frame.jpg"


def _request(**overrides) -> VideoRequest:
    values = {
        "model": MODEL,
        "prompt": "角色向右自然行走，固定镜头",
        "seconds": 5,
        "size": "1280x720",
        "mode": "std",
        "first_frame": b"jpeg",
        "first_frame_url": PUBLIC_FRAME,
    }
    values.update(overrides)
    return VideoRequest(**values)


def _protocol() -> AgnesVideoProtocol:
    return AgnesVideoProtocol("agnes-secret")


def test_agnes_submit_uses_keyframe_contract_and_public_first_frame():
    """防止把现有 Kling 的 input_reference/std 请求形状发给 Agnes。"""
    call = _protocol().build_submit(_request())

    assert call.method == "POST"
    assert call.path == "/videos"
    assert call.headers == {"Authorization": "Bearer agnes-secret"}
    assert call.body == {
        "model": MODEL,
        "prompt": "角色向右自然行走，固定镜头",
        "seconds": "5",
        "mode": "keyframe",
        "size": "720P",
        "aspect_ratio": "16:9",
        "first_frame": PUBLIC_FRAME,
        "n": 1,
    }


@pytest.mark.parametrize(
    ("size", "aspect_ratio"),
    [
        ("720x720", "1:1"),
        ("960x720", "4:3"),
        ("720x960", "3:4"),
        ("720x1280", "9:16"),
        ("1680x720", "21:9"),
    ],
)
def test_agnes_submit_maps_supported_canvas_ratios(size, aspect_ratio):
    assert (
        _protocol().build_submit(_request(size=size)).body["aspect_ratio"]
        == aspect_ratio
    )


def test_agnes_rejects_non_public_first_frame_before_spending():
    with pytest.raises(ValueError, match="公网 URL"):
        _protocol().build_submit(_request(first_frame_url="data:image/jpeg;base64,abc"))


def test_agnes_rejects_unsupported_duration_before_spending():
    with pytest.raises(ValueError, match="4.*12"):
        _protocol().build_submit(_request(seconds=13))


def test_agnes_submit_tracks_video_id_instead_of_task_id():
    response = httpx.Response(
        200,
        json={
            "id": "task-1",
            "task_id": "task-1",
            "video_id": "video-1",
            "status": "queued",
        },
    )

    result = _protocol().parse_submit(response)

    assert result.ok
    assert result.job_id == "video-1"
    assert result.job_status == "queued"


def test_agnes_poll_always_includes_model_name():
    call = _protocol().build_poll("video-1")

    assert call.method == "GET"
    assert call.path == (
        "https://apihub.agnes-ai.com/agnesapi"
        "?video_id=video-1&model_name=agnes-video-2.5"
    )


def test_agnes_completed_result_reads_metadata_url():
    response = httpx.Response(
        200,
        json={
            "video_id": "video-1",
            "status": "completed",
            "progress": 100,
            "metadata": {"url": "https://cdn.agnes-ai.com/out.mp4"},
        },
    )

    result = _protocol().parse_poll(response, "video-1")

    assert result.ok
    assert result.job_status == "completed"
    assert result.result_url == "https://cdn.agnes-ai.com/out.mp4"


def test_agnes_failed_result_is_upstream_failed_and_keeps_message():
    response = httpx.Response(
        200,
        json={
            "video_id": "video-1",
            "status": "failed",
            "error": {"message": "Invalid reference media"},
        },
    )

    result = _protocol().parse_poll(response, "video-1")

    assert result.error_type is ModelErrorType.UPSTREAM_FAILED
    assert result.job_status == "failed"
    assert "Invalid reference media" in result.edge_fingerprint


class _Uploader:
    def __init__(self) -> None:
        self.seen: list[tuple[bytes, str]] = []

    def upload(self, first_frame: bytes, content_type: str) -> str:
        self.seen.append((first_frame, content_type))
        return PUBLIC_FRAME


def _jpeg() -> bytes:
    from PIL import Image

    buf = io.BytesIO()
    Image.new("RGB", (32, 32), (80, 120, 160)).save(buf, "JPEG")
    return buf.getvalue()


def _provider(handler, *, api_key="agnes-secret", uploader=None) -> SufyVideoProvider:
    cfg = AIProviderSettings(
        base_url="https://api.modelink.ai/v1",
        api_key="modelink-secret",
        video_model=MODEL,
        video_agnes_base_url="https://apihub.agnes-ai.com/v1",
        video_agnes_api_key=api_key,
    )
    provider = SufyVideoProvider(
        config=cfg,
        model=MODEL,
        uploader=uploader,
        poll_interval=0.01,
        first_poll_after=0.01,
    )

    def client(model=None):
        agnes = model == MODEL
        return httpx.Client(
            base_url=(
                "https://apihub.agnes-ai.com/v1"
                if agnes
                else "https://api.modelink.ai/v1"
            ),
            headers={
                "Authorization": f"Bearer {api_key if agnes else 'modelink-secret'}"
            },
            transport=httpx.MockTransport(handler),
        )

    provider._client = client  # type: ignore[method-assign]
    return provider


def test_provider_uses_agnes_credentials_and_uploads_fitted_first_frame():
    seen: list[httpx.Request] = []
    uploader = _Uploader()

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(
            200,
            json={"video_id": "video-1", "task_id": "task-1", "status": "queued"},
        )

    result = _provider(handler, uploader=uploader).submit_video(
        _jpeg(), "向右走", 5, "1280x720", MODEL
    )

    assert result.ok and result.job_id == "video-1"
    assert str(seen[0].url) == "https://apihub.agnes-ai.com/v1/videos"
    assert seen[0].headers["Authorization"] == "Bearer agnes-secret"
    assert json.loads(seen[0].content)["first_frame"] == PUBLIC_FRAME
    assert len(uploader.seen) == 1
    assert uploader.seen[0][1] == "image/jpeg"


def test_provider_keeps_kling_on_modelink_credentials_and_data_uri():
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json={"id": "kling-job"})

    result = _provider(handler, uploader=_Uploader()).submit_video(
        _jpeg(), "向右走", 5, "1280x720", "kling-v2-5-turbo"
    )

    assert result.ok and result.job_id == "kling-job"
    assert str(seen[0].url) == "https://api.modelink.ai/v1/videos"
    assert seen[0].headers["Authorization"] == "Bearer modelink-secret"
    assert json.loads(seen[0].content)["input_reference"].startswith(
        "data:image/jpeg;base64,"
    )


def test_missing_agnes_key_is_rejected_before_upload_or_network():
    sent: list[httpx.Request] = []
    uploader = _Uploader()

    result = _provider(
        lambda request: sent.append(request) or httpx.Response(500),
        api_key="",
        uploader=uploader,
    ).submit_video(_jpeg(), "向右走", 5, "1280x720", MODEL)

    assert sent == []
    assert uploader.seen == []
    assert result.error_type is ModelErrorType.UNREACHED
    assert result.maybe_billed is False


def test_agnes_inspect_uses_root_poll_endpoint_and_agnes_key():
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(
            200,
            json={
                "video_id": "video-1",
                "status": "completed",
                "metadata": {"url": "https://cdn.agnes-ai.com/out.mp4"},
            },
        )

    result = _provider(handler, uploader=_Uploader()).inspect_job("video-1", MODEL)

    assert result.ok and result.job_status == "completed"
    assert str(seen[0].url) == (
        "https://apihub.agnes-ai.com/agnesapi"
        "?video_id=video-1&model_name=agnes-video-2.5"
    )
    assert seen[0].headers["Authorization"] == "Bearer agnes-secret"


def test_same_origin_agnes_download_uses_agnes_key():
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, content=b"mp4")

    result = _provider(handler, uploader=_Uploader()).download_completed(
        "video-1", "https://apihub.agnes-ai.com/files/out.mp4", model=MODEL
    )

    assert result.ok and result.body == b"mp4"
    assert seen[0].headers["Authorization"] == "Bearer agnes-secret"
