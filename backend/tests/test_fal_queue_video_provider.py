"""FAL 队列面 i2v 的回归测试(全程不联网:httpx.MockTransport + monkeypatch)。

护住的是三类"花了钱才发现"的错:
  1. 端点表写错 —— 提交路径 / 首帧字段名 / 轮询前缀三项各家都不同,猜不出来;
  2. 失败被当成成功 —— spec 明写失败也可能返回 COMPLETED,只看 status 会漏;
  3. 视频已生成却把整单丢掉 —— 下载重试与长度校验必须仍然生效。
"""

import io
import json

import httpx
import pytest

from windup_framework.config.provider import AIProviderSettings
from windup_framework.providers.interfaces import VideoProvider
from windup_framework.providers.sufy import (
    FAL_I2V_ENDPOINTS,
    FalQueueVideoProvider,
    FirstFrameNotPublicError,
    PreUploadedFirstFrame,
    UnknownVideoModelError,
    UnsupportedVideoOptionError,
    VideoJobFailedError,
    VideoJobTimeoutError,
    _api_root,
    _await_fal_video_url,
    fal_endpoint,
    fal_i2v_body,
    fal_submit_path,
)

VIDEO = b"\x00\x01mp4-bytes" * 64
FRAME_URL = "https://cdn.invalid/master.jpg"
VIDEO_URL = "https://cdn.invalid/out.mp4"

# 逐项抄自网关 OpenAPI spec(2026-08-07 下载的那批)。
# 元组 = (提交路径, 首帧字段名, 轮询/取结果前缀)。轮询前缀**不是**提交路径 + /requests:
# kling 六个型号共用一个家族级前缀,vidu 也把 q3/pro 段去掉了。
EXPECTED_ENDPOINTS = {
    "kling-v3-omni": (
        "/queue/fal-ai/kling-video/o3/{mode}/image-to-video",
        "image_url",
        "/queue/fal-ai/kling-video",
    ),
    "kling-v3": (
        "/queue/fal-ai/kling-video/v3/{mode}/image-to-video",
        "start_image_url",
        "/queue/fal-ai/kling-video",
    ),
    "kling-v3-turbo": (
        "/queue/fal-ai/kling-video/v3/turbo/{mode}/image-to-video",
        "image_url",
        "/queue/fal-ai/kling-video",
    ),
    "kling-v2-6": (
        "/queue/fal-ai/kling-video/v2.6/{mode}/image-to-video",
        "start_image_url",
        "/queue/fal-ai/kling-video",
    ),
    "kling-v2-5-turbo": (
        "/queue/fal-ai/kling-video/v2.5-turbo/{mode}/image-to-video",
        "image_url",
        "/queue/fal-ai/kling-video",
    ),
    "kling-video-o1": (
        "/queue/fal-ai/kling-video/o1/{mode}/image-to-video",
        "start_image_url",
        "/queue/fal-ai/kling-video",
    ),
    "veo3.1": (
        "/queue/fal-ai/veo3.1/image-to-video",
        "image_url",
        "/queue/fal-ai/veo3.1",
    ),
    "seedance-2.0": (
        "/queue/bytedance/seedance-2.0/image-to-video",
        "image_url",
        "/queue/bytedance/seedance-2.0",
    ),
    "minimax-h3": (
        "/queue/minimax/h3/image-to-video",
        "image_url",
        "/queue/minimax/h3",
    ),
    "vidu-q3-pro": (
        "/queue/fal-ai/vidu/q3/image-to-video/pro",
        "image_url",
        "/queue/fal-ai/vidu",
    ),
}

COMPLETED = {"status": "COMPLETED", "detail": None, "result": {"video": {"url": VIDEO_URL}}}


def _png(width: int = 900, height: int = 500) -> bytes:
    """真图,不是假 bytes —— 首帧补边那一步会真的解码它。"""
    from PIL import Image

    buf = io.BytesIO()
    Image.new("RGB", (width, height), (30, 60, 90)).save(buf, "PNG")
    return buf.getvalue()


def _config() -> AIProviderSettings:
    # base_url 故意带 /v1:FAL 面在网关根,provider 必须自己退回去。
    return AIProviderSettings(base_url="https://gw.invalid/v1", api_key="test-key")


def _install_transport(monkeypatch, handler) -> None:
    """让 provider 自己造的 client 走 MockTransport,同时保留它设的 base_url / 鉴权头。"""
    real_client = httpx.Client

    def factory(**kwargs):
        return real_client(transport=httpx.MockTransport(handler), **kwargs)

    monkeypatch.setattr("windup_framework.providers.sufy.httpx.Client", factory)
    monkeypatch.setattr("windup_framework.providers.sufy.time.sleep", lambda _: None)


class _Uploader:
    """记录被上传的首帧,返回一个固定的公网 URL。"""

    def __init__(self, url: str = FRAME_URL) -> None:
        self.url = url
        self.uploaded: list[tuple[bytes, str]] = []

    def upload(self, frame: bytes, content_type: str) -> str:
        self.uploaded.append((frame, content_type))
        return self.url


def _gateway(calls: list, *, states: list[dict], result: dict | None = None):
    """一个最小的 FAL 网关:提交给 request_id,状态按 states 顺序吐,视频 URL 给 bytes。"""

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        if request.method == "POST":
            return httpx.Response(200, json={"request_id": "req-1", "status": "IN_QUEUE"})
        if request.url.path.endswith("/status"):
            state = states[min(len(calls) - 2, len(states) - 1)]
            in_flight = state.get("status") in ("IN_QUEUE", "IN_PROGRESS")
            return httpx.Response(202 if in_flight else 200, json=state)
        if request.url.path.endswith("/requests/req-1"):
            return httpx.Response(200, json=result or {})
        return httpx.Response(200, content=VIDEO)

    return handler


def _provider(monkeypatch, handler, model: str = "kling-v2-5-turbo", mode: str = "std"):
    _install_transport(monkeypatch, handler)
    return FalQueueVideoProvider(_Uploader(), config=_config(), model=model, mode=mode)


# ── 端点表:三项各家都不同,只能查表 ────────────────────────────────────────


@pytest.mark.parametrize("model", sorted(EXPECTED_ENDPOINTS))
def test_each_model_resolves_to_the_path_and_image_field_in_the_spec(model):
    """每个模型解析出 spec 里的提交路径、首帧字段名与轮询前缀。"""
    submit_path, image_field, queue_base = EXPECTED_ENDPOINTS[model]
    endpoint = fal_endpoint(model)

    assert endpoint.submit_path == submit_path
    assert endpoint.image_field == image_field
    assert endpoint.queue_base == queue_base
    # 字段名要真的落到请求体上,而不是只写在表里。
    # 时长 / 画幅取该模型自己支持的值:各家能接的取值本就不同(veo 没有 5 秒,
    # minimax 没有 720 档),用一组固定值反而会把这个测试变成时长测试。
    seconds = min(endpoint.seconds)
    size = f"1280x{min(endpoint.resolutions)}" if endpoint.resolutions else "1280x720"
    assert image_field in fal_i2v_body(model, "walk", FRAME_URL, seconds, size)


def test_table_holds_only_models_checked_against_the_spec():
    """新增模型必须同时补 EXPECTED_ENDPOINTS,逼作者回 spec 抄那三项。"""
    assert set(FAL_I2V_ENDPOINTS) == set(EXPECTED_ENDPOINTS)


def test_same_family_different_generation_uses_different_image_field():
    """o3 / v2.5-turbo 是 image_url,v3 / v2.6 / o1 是 start_image_url —— 最容易顺手写错的一处。"""
    assert fal_endpoint("kling-v3-omni").image_field == "image_url"
    assert fal_endpoint("kling-v3").image_field == "start_image_url"
    assert fal_endpoint("kling-video-o1").image_field == "start_image_url"


def test_unknown_model_raises_instead_of_guessing_a_path():
    with pytest.raises(UnknownVideoModelError, match="不在 FAL 图生视频端点表里"):
        fal_endpoint("kling-v9-imaginary")
    # 前缀像、但没登记的一样要炸(别退化成前缀匹配)
    with pytest.raises(UnknownVideoModelError):
        fal_submit_path("kling-v3-omni-pro", "std")


def test_unsupported_mode_raises_before_submitting():
    """v2.6 只有 pro;v3-turbo 只有 standard/pro(没有 std)。"""
    with pytest.raises(UnsupportedVideoOptionError, match="mode"):
        fal_submit_path("kling-v2-6", "std")
    with pytest.raises(UnsupportedVideoOptionError, match="mode"):
        fal_submit_path("kling-v3-turbo", "std")
    assert fal_submit_path("kling-v2-6", "pro").endswith("/v2.6/pro/image-to-video")


def test_paths_without_a_mode_segment_ignore_mode():
    assert fal_submit_path("veo3.1", "std") == "/queue/fal-ai/veo3.1/image-to-video"
    assert fal_submit_path("minimax-h3", "pro") == "/queue/minimax/h3/image-to-video"


# ── 请求体形态:时长三种写法、分辨率档位不做就近替换 ────────────────────────


def test_duration_is_rendered_in_each_vendors_own_shape():
    assert fal_i2v_body("kling-v2-5-turbo", "p", FRAME_URL, 5, "1280x720")["duration"] == "5"
    assert fal_i2v_body("veo3.1", "p", FRAME_URL, 8, "1280x720")["duration"] == "8s"
    assert fal_i2v_body("minimax-h3", "p", FRAME_URL, 5, "1024x768")["duration"] == 5


def test_unsupported_duration_raises():
    """v2.5-turbo 只有 5 / 10 秒。"""
    with pytest.raises(UnsupportedVideoOptionError, match="秒"):
        fal_i2v_body("kling-v2-5-turbo", "p", FRAME_URL, 7, "1280x720")


def test_models_without_a_resolution_knob_do_not_send_one():
    """kling 系没有 resolution 字段,画幅跟随首帧;硬塞会被网关 400。"""
    assert "resolution" not in fal_i2v_body("kling-v3-omni", "p", FRAME_URL, 5, "1280x720")


def test_resolution_without_a_matching_tier_raises_instead_of_snapping():
    """minimax 只有 768P / 2K。悄悄把 720 换成 768P = 出片尺寸与调用方要的不一致。"""
    assert fal_i2v_body("minimax-h3", "p", FRAME_URL, 5, "1024x768")["resolution"] == "768P"
    with pytest.raises(UnsupportedVideoOptionError, match="分辨率档位"):
        fal_i2v_body("minimax-h3", "p", FRAME_URL, 5, "1280x720")


def test_audio_is_switched_off_where_the_model_has_the_flag():
    """多数端点 generate_audio 默认 true;序列帧不要声音,不关等于白花钱。"""
    assert fal_i2v_body("kling-v3", "p", FRAME_URL, 5, "1280x720")["generate_audio"] is False
    assert fal_i2v_body("vidu-q3-pro", "p", FRAME_URL, 5, "1280x720")["audio"] is False


def test_base_url_v1_suffix_is_stripped_back_to_the_gateway_root():
    """/queue 与 /v1 平级,拿 base_url 直接拼会得到 /v1/queue/... → 404。"""
    assert _api_root("https://gw.invalid/v1") == "https://gw.invalid"
    assert _api_root("https://gw.invalid/v1/") == "https://gw.invalid"
    assert _api_root("https://gw.invalid") == "https://gw.invalid"


# ── 端到端(mock):提交 → 轮询 → 下载 ──────────────────────────────────────


def test_end_to_end_hits_the_right_paths(monkeypatch):
    calls: list[httpx.Request] = []
    provider = _provider(
        monkeypatch,
        _gateway(calls, states=[{"status": "IN_PROGRESS"}, COMPLETED]),
        model="kling-v3",
        mode="pro",
    )

    assert provider.i2v(_png(), "walk cycle", seconds=5, size="1280x720") == VIDEO

    submit, first_poll, second_poll, download = calls
    assert submit.method == "POST"
    assert submit.url.path == "/queue/fal-ai/kling-video/v3/pro/image-to-video"
    # FAL 面是 Key 不是 Bearer(spec 的 securitySchemes 两套并列写明)
    assert submit.headers["authorization"] == "Key test-key"
    # 轮询打在家族级前缀上,不是提交路径 + /requests
    assert first_poll.url.path == "/queue/fal-ai/kling-video/requests/req-1/status"
    assert second_poll.url.path == first_poll.url.path
    assert str(download.url) == VIDEO_URL
    # 成品 URL 在 CDN 域名下(gw.invalid → cdn.invalid),这一跳不能带 API key。
    # 端到端这一层单独断言:_download 的单测再全,也管不住调用方哪天又把凭证塞回来。
    assert "authorization" not in download.headers, "API key 被发给了 CDN(PR #179 P1)"
    assert download.url.host != submit.url.host


def test_first_frame_is_padded_then_uploaded_and_enters_the_body_as_a_url(monkeypatch):
    from PIL import Image

    calls: list[httpx.Request] = []
    _install_transport(monkeypatch, _gateway(calls, states=[COMPLETED]))
    uploader = _Uploader()
    provider = FalQueueVideoProvider(uploader, config=_config(), model="kling-v2-5-turbo")

    provider.i2v(_png(900, 500), "walk", seconds=5, size="1280x720")

    frame, content_type = uploader.uploaded[0]
    assert content_type == "image/jpeg"
    assert Image.open(io.BytesIO(frame)).size == (1280, 720)  # 补边到目标画幅
    assert json.loads(calls[0].content)["image_url"] == FRAME_URL


def test_no_request_is_sent_when_the_uploader_gives_no_public_url(monkeypatch):
    """dataURI / 本地路径在这一面产不出正确结果,必须在**提交之前**炸。"""

    def handler(request: httpx.Request) -> httpx.Response:
        raise AssertionError(f"不该发出任何请求: {request.url}")

    _install_transport(monkeypatch, handler)
    provider = FalQueueVideoProvider(_Uploader("data:image/jpeg;base64,AAAA"), config=_config())

    with pytest.raises(FirstFrameNotPublicError, match="http"):
        provider.i2v(_png(), "walk")


def test_unsupported_options_are_rejected_before_the_frame_is_uploaded(monkeypatch):
    """上传首帧要花钱/占带宽,不该为一个必然被拒的请求先传图。"""

    def handler(request: httpx.Request) -> httpx.Response:
        raise AssertionError(f"不该发出任何请求: {request.url}")

    _install_transport(monkeypatch, handler)
    uploader = _Uploader()
    provider = FalQueueVideoProvider(uploader, config=_config(), model="kling-v2-5-turbo")

    with pytest.raises(UnsupportedVideoOptionError, match="秒"):
        provider.i2v(_png(), "walk", seconds=7)
    assert uploader.uploaded == []


def test_unknown_model_and_bad_mode_are_rejected_at_construction():
    """炸在构造,而不是等到 i2v 真去提交任务。"""
    with pytest.raises(UnknownVideoModelError):
        FalQueueVideoProvider(_Uploader(), config=_config(), model="nope")
    with pytest.raises(UnsupportedVideoOptionError):
        FalQueueVideoProvider(_Uploader(), config=_config(), model="kling-v2-6", mode="std")


def test_satisfies_the_video_provider_contract():
    assert isinstance(FalQueueVideoProvider(_Uploader(), config=_config()), VideoProvider)


# ── 轮询的失败面:任何非成功终态都要炸 ──────────────────────────────────────


def _poll(states: list[dict], monkeypatch, *, result: dict | None = None, max_min: int = 30):
    monkeypatch.setattr("windup_framework.providers.sufy.time.sleep", lambda _: None)
    seen = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/status"):
            state = states[min(seen["n"], len(states) - 1)]
            seen["n"] += 1
            return httpx.Response(200, json=state)
        return httpx.Response(200, json=result or {})

    client = httpx.Client(transport=httpx.MockTransport(handler), base_url="https://gw.invalid")
    with client:
        return _await_fal_video_url(client, fal_endpoint("kling-v3"), "req-1", 1.0, max_min)


def test_failed_status_raises(monkeypatch):
    with pytest.raises(VideoJobFailedError, match="任务失败"):
        _poll([{"status": "FAILED", "detail": {"msg": "内容审核不通过"}}], monkeypatch)


def test_completed_with_detail_is_a_disguised_failure(monkeypatch):
    """spec 明写:失败时后端也返回 COMPLETED,靠 detail 区分。只看 status 会当成功。"""
    with pytest.raises(VideoJobFailedError, match="实为失败"):
        _poll(
            [{"status": "COMPLETED", "detail": {"msg": "upstream error"}, "result": {}}],
            monkeypatch,
        )


def test_unrecognised_status_is_treated_as_failure(monkeypatch):
    """continue 下去会把"协议变了"伪装成"生成太慢",转满预算才报超时。"""
    with pytest.raises(VideoJobFailedError, match="未知状态"):
        _poll([{"status": "SUCCEEDED"}], monkeypatch)


def test_timeout_raises_instead_of_returning_nothing(monkeypatch):
    with pytest.raises(VideoJobTimeoutError, match="仍未出片"):
        _poll([{"status": "IN_PROGRESS"}], monkeypatch, max_min=1)


def test_completed_without_inline_url_falls_back_to_the_result_endpoint(monkeypatch):
    """视频已生成、费用已产生,不为省一次 GET 丢整单;取不到才炸。"""
    states = [{"status": "COMPLETED", "detail": None, "result": {}}]
    assert _poll(states, monkeypatch, result={"video": {"url": VIDEO_URL}}) == VIDEO_URL

    with pytest.raises(VideoJobFailedError, match="没有视频 URL"):
        _poll(states, monkeypatch, result={})


# ── 下载重试:视频已生成、费用已产生,断一次不能整单作废 ────────────────────


def test_download_retry_still_applies_on_the_fal_route(monkeypatch):
    downloads = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "POST":
            return httpx.Response(200, json={"request_id": "req-1"})
        if request.url.path.endswith("/status"):
            return httpx.Response(200, json=COMPLETED)
        downloads["n"] += 1
        if downloads["n"] == 1:
            raise httpx.RemoteProtocolError(
                "peer closed connection without sending complete message body", request=request
            )
        return httpx.Response(200, content=VIDEO)

    provider = _provider(monkeypatch, handler)
    assert provider.i2v(_png(), "walk") == VIDEO
    assert downloads["n"] == 2


def test_truncated_download_is_still_caught_by_the_length_check(monkeypatch):
    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "POST":
            return httpx.Response(200, json={"request_id": "req-1"})
        if request.url.path.endswith("/status"):
            return httpx.Response(200, json=COMPLETED)
        return httpx.Response(200, content=VIDEO[:10], headers={"content-length": str(len(VIDEO))})

    provider = _provider(monkeypatch, handler)
    with pytest.raises(RuntimeError, match="已重试 3 次"):
        provider.i2v(_png(), "walk")


# ── 提交被拒:把网关给的原因带出来 ──────────────────────────────────────────


def test_rejected_submit_surfaces_the_gateway_reason(monkeypatch):
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(400, json={"detail": {"msg": "image_url is required"}})

    provider = _provider(monkeypatch, handler)
    with pytest.raises(VideoJobFailedError, match="image_url is required"):
        provider.i2v(_png(), "walk")


def test_submit_without_request_id_raises(monkeypatch):
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"status": "IN_QUEUE"})

    provider = _provider(monkeypatch, handler)
    with pytest.raises(VideoJobFailedError, match="request_id"):
        provider.i2v(_png(), "walk")


# ── 已在公网的首帧:零成本 uploader ────────────────────────────────────────


def test_pre_uploaded_first_frame_returns_the_url_as_is():
    uploader = PreUploadedFirstFrame(FRAME_URL)
    assert uploader.upload(b"ignored", "image/jpeg") == FRAME_URL
    with pytest.raises(FirstFrameNotPublicError):
        PreUploadedFirstFrame("/tmp/local.png")
