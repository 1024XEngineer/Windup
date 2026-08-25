"""两条新生图协议面,以及型号到协议面的分派。

分派那组是重点:只证明两个 face 类自己能跑不够 —— 加了通路却没接到生产调用点时,
生产恒走旧的那条面、既不报错也不生效,而直接构造 face 的测试照样全绿。
"""
from __future__ import annotations

import base64

import httpx
import pytest
from windup_common.enums.model import ModelErrorType
from windup_framework.config.provider import AIProviderSettings
from windup_framework.providers.protocol.image_faces import (
    MIN_IMAGE_BYTES,
    FalQueueImageFace,
    OpenAIImagesFace,
    UnknownFalImageModelError,
)
from windup_framework.providers.sufy import SufyImageProvider

PNG = b"\x89PNG\r\n\x1a\n" + b"0" * MIN_IMAGE_BYTES
B64 = base64.b64encode(PNG).decode()
FLASH = "gemini-3.1-flash-image-preview"


def _face(cls, handler, **kw):
    face = cls("https://gw.example.com/v1", "k", 10.0, **kw)
    base = "https://gw.example.com/v1" if cls is OpenAIImagesFace else "https://gw.example.com"
    face._client = lambda: httpx.Client(
        base_url=base, transport=httpx.MockTransport(handler)
    )
    return face


# ── OpenAI 图像面 ──────────────────────────────────────────────────────────

def test_openai_face_posts_generations_and_decodes_b64():
    seen: list[httpx.Request] = []

    def handler(req):
        seen.append(req)
        return httpx.Response(200, json={"data": [{"b64_json": B64}]})

    r = _face(OpenAIImagesFace, handler).submit_image("一个剑客", [], "gpt-image-2")
    assert r.ok and r.body == PNG
    assert seen[0].url.path.endswith("/images/generations")
    body = seen[0].read().decode()
    assert '"model":"gpt-image-2"' in body.replace(" ", "")
    assert "1024x1024" in body


def test_openai_face_downloads_when_only_a_url_is_returned():
    def handler(req):
        if req.url.path.endswith("/images/generations"):
            return httpx.Response(200, json={"data": [{"url": "https://cdn.example.com/a.png"}]})
        return httpx.Response(200, content=PNG)

    r = _face(OpenAIImagesFace, handler).submit_image("p", [], "gpt-image-2")
    assert r.ok and r.body == PNG


def test_openai_face_switches_to_edits_when_refs_are_given():
    seen: list[str] = []

    def handler(req):
        seen.append(req.url.path)
        return httpx.Response(200, json={"data": [{"b64_json": B64}]})

    r = _face(OpenAIImagesFace, handler).submit_image("p", [PNG], "gpt-image-2")
    assert r.ok
    assert seen[0].endswith("/images/edits"), "有参考图仍走文生图 = 参考图被静默丢掉"


def test_openai_face_rejects_an_undersized_image_instead_of_returning_it():
    tiny = base64.b64encode(b"\x89PNG" + b"0" * 10).decode()
    r = _face(
        OpenAIImagesFace, lambda req: httpx.Response(200, json={"data": [{"b64_json": tiny}]})
    ).submit_image("p", [], "gpt-image-2")
    assert not r.ok and r.error_type is ModelErrorType.INVALID_RESPONSE


@pytest.mark.parametrize("code", [400, 404])
def test_openai_face_says_the_catalogue_may_not_have_the_model(code):
    r = _face(
        OpenAIImagesFace, lambda req: httpx.Response(code, text="no such model")
    ).submit_image("p", [], "gpt-image-2")
    assert not r.ok
    assert "gpt-image-2" in r.edge_fingerprint and "真实调用" in r.edge_fingerprint


# ── FAL 队列生图面 ────────────────────────────────────────────────────────

def _queue_handler(states, *, images=None):
    """建单 → 依次吐出 states 里的状态 → 取结果 → 下载。"""
    seq = list(states)

    def handler(req):
        path = req.url.path
        if path.endswith("/status"):
            return httpx.Response(200, json={"status": seq.pop(0) if seq else "COMPLETED"})
        if path.startswith("/queue/") and req.method == "POST":
            return httpx.Response(200, json={"request_id": "req-1"})
        if "/requests/" in path:
            return httpx.Response(200, json={"images": images if images is not None
                                             else [{"url": "https://cdn.example.com/a.png"}]})
        return httpx.Response(200, content=PNG)

    return handler


def test_fal_face_submits_polls_then_downloads():
    face = _face(FalQueueImageFace, _queue_handler(["IN_QUEUE", "IN_PROGRESS", "COMPLETED"]),
                 poll_s=0)
    r = face.submit_image("p", [], FLASH)
    assert r.ok and r.body == PNG


def test_fal_face_uses_the_edit_endpoint_and_data_uris_for_refs():
    seen: list[tuple[str, str]] = []

    def handler(req):
        if req.method == "POST":
            seen.append((req.url.path, req.read().decode()))
            return httpx.Response(200, json={"request_id": "req-1"})
        return _queue_handler(["COMPLETED"])(req)

    r = _face(FalQueueImageFace, handler, poll_s=0).submit_image("p", [PNG], FLASH)
    assert r.ok
    assert seen[0][0].endswith("/edit"), "有参考图仍走文生图端点"
    assert "data:image/png;base64," in seen[0][1]


def test_fal_face_rejects_an_unregistered_model_rather_than_guessing_the_path():
    with pytest.raises(UnknownFalImageModelError):
        _face(FalQueueImageFace, _queue_handler(["COMPLETED"]), poll_s=0).submit_image(
            "p", [], "some-other-image-model"
        )


def test_fal_face_reports_timeout_as_maybe_billed():
    face = _face(FalQueueImageFace, _queue_handler(["IN_QUEUE"] * 10), poll_s=0, max_polls=3)
    r = face.submit_image("p", [], FLASH)
    assert not r.ok and r.error_type is ModelErrorType.TIMEOUT
    assert r.maybe_billed, "在途超时时任务可能已经产生费用,记成没花钱会让账对不上"


def test_fal_face_without_a_request_id_is_invalid_not_a_silent_success():
    def handler(req):
        return httpx.Response(200, json={"detail": "queued"})

    r = _face(FalQueueImageFace, handler, poll_s=0).submit_image("p", [], FLASH)
    assert not r.ok and r.error_type is ModelErrorType.INVALID_RESPONSE


def test_fal_face_result_without_images_is_invalid():
    face = _face(FalQueueImageFace, _queue_handler(["COMPLETED"], images=[]), poll_s=0)
    r = face.submit_image("p", [], FLASH)
    assert not r.ok and r.error_type is ModelErrorType.INVALID_RESPONSE


# ── 分派:型号决定走哪条面 ──────────────────────────────────────────────────

@pytest.mark.parametrize(
    ("model", "expect"),
    [
        ("gpt-image-2", OpenAIImagesFace),
        (FLASH, FalQueueImageFace),
        ("gemini-2.5-flash-image", type(None)),  # None = 落回 chat 面
    ],
)
def test_provider_picks_the_face_the_registry_registered(model, expect):
    p = SufyImageProvider(
        config=AIProviderSettings(base_url="https://gw.example.com/v1", api_key="k")
    )
    assert isinstance(p._face(model), expect)


def test_provider_dispatches_per_call_not_per_instance():
    """同一个 provider 实例要能按型号换面 —— 网关兜底那一跳换的是型号不是 adapter。

    分派若写在构造函数里,跨面兜底会拿主型号的形状去发备用型号的请求:HTTP 200、
    费用照产生、拿回来的却不是图。
    """
    p = SufyImageProvider(
        config=AIProviderSettings(base_url="https://gw.example.com/v1", api_key="k")
    )
    assert isinstance(p._face("gpt-image-2"), OpenAIImagesFace)
    assert isinstance(p._face(FLASH), FalQueueImageFace)


def test_submit_image_routes_gpt_image_2_to_the_openai_face(monkeypatch):
    """从 provider 的公开入口进,证明新面真的被生产路径走到,而不是只是能被构造出来。"""
    called: dict = {}

    def fake_submit(self, prompt, refs, model):
        called["model"] = model
        from windup_framework.gateway.types import AdapterResult

        return AdapterResult(ok=True, body=PNG, http_status=200)

    monkeypatch.setattr(OpenAIImagesFace, "submit_image", fake_submit)
    p = SufyImageProvider(
        config=AIProviderSettings(base_url="https://gw.example.com/v1", api_key="k")
    )
    assert p.gen_image("p", []) == PNG
    assert called["model"] == "gpt-image-2", "默认型号没走到 OpenAI 图像面"


# ── 失败分支:这些路径上钱可能已经花了,收成什么错决定要不要重发 ──────────────

def _boom(req):
    raise httpx.ConnectError("连不上", request=req)


@pytest.mark.parametrize("cls", [OpenAIImagesFace, FalQueueImageFace])
def test_transport_error_on_submit_is_not_a_billed_failure(cls):
    kw = {"poll_s": 0} if cls is FalQueueImageFace else {}
    model = "gpt-image-2" if cls is OpenAIImagesFace else FLASH
    r = _face(cls, _boom, **kw).submit_image("p", [], model)
    assert not r.ok and not r.maybe_billed, "还没拿到状态行,不该记成可能已计费"


def test_openai_face_non_json_body_is_invalid_response():
    r = _face(
        OpenAIImagesFace, lambda req: httpx.Response(200, text="<html>502</html>")
    ).submit_image("p", [], "gpt-image-2")
    assert not r.ok and r.error_type is ModelErrorType.INVALID_RESPONSE


def test_openai_face_empty_data_is_invalid_response():
    r = _face(
        OpenAIImagesFace, lambda req: httpx.Response(200, json={"data": []})
    ).submit_image("p", [], "gpt-image-2")
    assert not r.ok and r.error_type is ModelErrorType.INVALID_RESPONSE


def test_openai_face_item_without_bytes_or_url_is_invalid_response():
    r = _face(
        OpenAIImagesFace, lambda req: httpx.Response(200, json={"data": [{"revised_prompt": "x"}]})
    ).submit_image("p", [], "gpt-image-2")
    assert not r.ok and "b64_json" in r.edge_fingerprint


def test_openai_face_failed_download_is_invalid_not_success():
    def handler(req):
        if req.url.path.endswith("/images/generations"):
            return httpx.Response(200, json={"data": [{"url": "https://cdn.example.com/a.png"}]})
        return httpx.Response(403, text="denied")

    r = _face(OpenAIImagesFace, handler).submit_image("p", [], "gpt-image-2")
    assert not r.ok and "403" in r.edge_fingerprint


def test_fal_face_submit_rejection_carries_the_http_status():
    r = _face(
        FalQueueImageFace, lambda req: httpx.Response(429, text="rate limited"), poll_s=0
    ).submit_image("p", [], FLASH)
    assert not r.ok and r.http_status == 429


def test_fal_face_poll_failure_stops_instead_of_spinning():
    def handler(req):
        if req.method == "POST":
            return httpx.Response(200, json={"request_id": "req-1"})
        return httpx.Response(500, text="boom")

    r = _face(FalQueueImageFace, handler, poll_s=0).submit_image("p", [], FLASH)
    assert not r.ok and r.http_status == 500


def test_fal_face_fetch_failure_is_reported():
    def handler(req):
        if req.method == "POST":
            return httpx.Response(200, json={"request_id": "req-1"})
        if req.url.path.endswith("/status"):
            return httpx.Response(200, json={"status": "COMPLETED"})
        return httpx.Response(502, text="bad gateway")

    r = _face(FalQueueImageFace, handler, poll_s=0).submit_image("p", [], FLASH)
    assert not r.ok and r.http_status == 502


def test_fal_face_failed_download_is_invalid_not_success():
    def handler(req):
        if req.method == "POST":
            return httpx.Response(200, json={"request_id": "req-1"})
        if req.url.path.endswith("/status"):
            return httpx.Response(200, json={"status": "COMPLETED"})
        if "/requests/" in req.url.path:
            return httpx.Response(200, json={"images": [{"url": "https://cdn.example.com/a.png"}]})
        return httpx.Response(404, text="gone")

    r = _face(FalQueueImageFace, handler, poll_s=0).submit_image("p", [], FLASH)
    assert not r.ok and "404" in r.edge_fingerprint


def test_faces_build_a_real_client_with_the_right_auth_scheme():
    """两条面的鉴权头不同:OpenAI 面是 Bearer,FAL 队列面是 Key。搞反了一律 401。"""
    o = OpenAIImagesFace("https://gw.example.com/v1", "k", 10.0)
    with o._client() as c:
        assert c.headers["Authorization"] == "Bearer k"
    f = FalQueueImageFace("https://gw.example.com/v1", "k", 10.0)
    with f._client() as c:
        assert c.headers["Authorization"] == "Key k"
        assert str(c.base_url).rstrip("/").endswith("gw.example.com"), "/queue 与 /v1 平级"


def _raise_on(marker: str, ok_handler):
    """只在路径命中 marker 那一步断线,用来钉"中途断线"而不是"一开始就连不上"。"""
    def handler(req):
        if marker in str(req.url):
            raise httpx.ReadError("中途断线", request=req)
        return ok_handler(req)
    return handler


def test_openai_face_survives_a_drop_while_downloading_the_result():
    def ok(req):
        return httpx.Response(200, json={"data": [{"url": "https://cdn.example.com/a.png"}]})

    r = _face(OpenAIImagesFace, _raise_on("cdn.example.com", ok)).submit_image(
        "p", [], "gpt-image-2"
    )
    assert not r.ok and r.body == b"", "断线时不能返回空 bytes 当成功"


@pytest.mark.parametrize("marker", ["/status", "/requests/req-1", "cdn.example.com"])
def test_fal_face_reports_a_drop_at_any_of_the_three_steps(marker):
    base = _queue_handler(["COMPLETED"])
    r = _face(FalQueueImageFace, _raise_on(marker, base), poll_s=0).submit_image("p", [], FLASH)
    assert not r.ok, f"{marker} 那一步断线被当成了成功"
