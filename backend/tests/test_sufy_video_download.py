"""视频成品下载的凭证边界、重试与完整性校验(不联网:用 httpx MockTransport)。

两个回归对象:

1. 2026-08-05 实测两次连续复现:视频已生成、费用已产生,却因为读 body 时断了一次连接
   就整单丢弃。见 ``providers.sufy._download`` 的 docstring。
2. 2026-08-10 机器审(PR #179 P1):成品 URL 是网关返回的绝对地址,复用带 Authorization
   的 client 去下载 = 把 API key 发给了 CDN(或网关返回的任意地址)。
   见 ``providers.sufy._download_request`` 的 docstring。
"""

from datetime import datetime, timezone
import json

import httpx
import pytest

from windup_common.enums.model import ModelErrorType
from windup_framework.gateway.classify import _utc_now, retry_after_seconds
from windup_framework.providers.sufy import (
    IncompleteDownloadError,
    UnsafeDownloadUrlError,
    _download,
)

VIDEO = b"\x00\x01mp4-bytes" * 64
GATEWAY = "https://gw.invalid/v1"


def _client(handler) -> httpx.Client:
    return httpx.Client(transport=httpx.MockTransport(handler))


def _authed_client(handler, base_url: str = GATEWAY) -> httpx.Client:
    """带凭证的网关 client —— provider 真正持有的就是这种(Authorization + cookie jar)。"""
    return httpx.Client(
        transport=httpx.MockTransport(handler),
        base_url=base_url,
        headers={"Authorization": "Key secret-api-key"},
        cookies={"session": "s3cr3t"},
    )


def test_retries_after_peer_closed_connection(monkeypatch):
    """第一次断连、第二次成功 —— 原实现在这里会整单丢弃。"""
    monkeypatch.setattr("windup_framework.providers.sufy.time.sleep", lambda _: None)
    calls = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        if calls["n"] == 1:
            raise httpx.RemoteProtocolError(
                "peer closed connection without sending complete message body", request=request
            )
        return httpx.Response(200, content=VIDEO)

    with _client(handler) as client:
        assert _download(client, "https://example.invalid/v.mp4") == VIDEO
    assert calls["n"] == 2


def test_rejects_truncated_body_that_does_not_raise(monkeypatch):
    """服务端声明的长度与实收不符时必须失败,而不是把坏视频往下游送。

    截断不一定抛异常。放过去的话,坏视频要到出帧环节才暴露成"解码失败",
    很难回溯到下载这一步。
    """
    monkeypatch.setattr("windup_framework.providers.sufy.time.sleep", lambda _: None)

    def handler(request: httpx.Request) -> httpx.Response:
        # 只回一半 body,但 Content-Length 仍声明全长
        return httpx.Response(
            200, content=VIDEO[: len(VIDEO) // 2], headers={"content-length": str(len(VIDEO))}
        )

    with _client(handler) as client, pytest.raises(RuntimeError, match="已重试 3 次"):
        _download(client, "https://example.invalid/v.mp4")


def test_accepts_chunked_response_without_content_length(monkeypatch):
    """分块传输没有 Content-Length,此时跳过校验而不是误判为不完整。"""
    monkeypatch.setattr("windup_framework.providers.sufy.time.sleep", lambda _: None)

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, stream=httpx.ByteStream(VIDEO))

    with _client(handler) as client:
        assert _download(client, "https://example.invalid/v.mp4") == VIDEO


def test_gives_up_after_three_tries_and_reports_the_last_cause(monkeypatch):
    """一直断连时要显式失败,并把最后一次的真实原因带出来。"""
    monkeypatch.setattr("windup_framework.providers.sufy.time.sleep", lambda _: None)
    calls = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        raise httpx.ConnectError("connection reset", request=request)

    with _client(handler) as client, pytest.raises(RuntimeError, match="connection reset"):
        _download(client, "https://example.invalid/v.mp4")
    assert calls["n"] == 3


def test_incomplete_download_error_is_a_runtime_error():
    """调用方按 RuntimeError 兜底即可,不必单独 import 这个子类。"""
    assert issubclass(IncompleteDownloadError, RuntimeError)


# ── 凭证边界:成品 URL 是网关给的外部地址,不能带着 API key 去取 ──────────────


def test_cross_origin_download_does_not_leak_the_api_key(monkeypatch):
    """跨源下载必须摘掉 client 级凭证。

    这是 PR #179 P1 的直接回归:httpx 只在跨源**重定向**时自动摘 Authorization,
    对一开始就跨源的直连请求会原样带上 —— 于是 CDN 域名收到了 API key。
    """
    monkeypatch.setattr("windup_framework.providers.sufy.time.sleep", lambda _: None)
    seen: dict[str, str | None] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["authorization"] = request.headers.get("authorization")
        seen["cookie"] = request.headers.get("cookie")
        return httpx.Response(200, content=VIDEO)

    with _authed_client(handler) as client:
        assert _download(client, "https://cdn.invalid/out.mp4") == VIDEO

    assert seen["authorization"] is None, "API key 被发给了 CDN"
    assert seen["cookie"] is None, "会话 cookie 被发给了 CDN"


def test_same_origin_download_keeps_the_gateway_credential(monkeypatch):
    """同源(网关自己签发的下载链接)必须保留凭证,否则那条路径就是 401。

    一律摘头会把这个功能弄坏,所以判据是目标地址,不是"下载一律不带凭证"。
    """
    monkeypatch.setattr("windup_framework.providers.sufy.time.sleep", lambda _: None)
    seen: list[str | None] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request.headers.get("authorization"))
        return httpx.Response(200, content=VIDEO)

    with _authed_client(handler) as client:
        # 第二个地址显式写出默认端口 443。httpx 0.28 会把默认端口归一化掉(URL.port -> None),
        # 所以这条今天走不到"补默认端口"那行;留着是钉住这个前提 —— httpx 哪天不再归一化,
        # 少了默认端口补齐就会把它误判成跨源、把凭证摘掉,这条会先叫。
        assert _download(client, "https://gw.invalid/files/out.mp4") == VIDEO
        assert _download(client, "https://gw.invalid:443/files/out.mp4") == VIDEO

    assert seen == ["Key secret-api-key", "Key secret-api-key"]


def test_downgrade_to_plain_http_is_treated_as_cross_origin(monkeypatch):
    """同 host 但 scheme 从 https 掉到 http —— 也要摘凭证。

    默认端口被 httpx 归一化成 None,host 又相同,所以同源判定里**少比一个 scheme**
    就会把它当自己人,于是 API key 走明文 HTTP 发出去。httpx 自己在重定向那侧也是
    单独处理 http/https 的(``_is_https_redirect``),方向只允许 http→https,不允许反过来。
    """
    monkeypatch.setattr("windup_framework.providers.sufy.time.sleep", lambda _: None)
    seen: dict[str, str | None] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["authorization"] = request.headers.get("authorization")
        return httpx.Response(200, content=VIDEO)

    with _authed_client(handler) as client:
        assert _download(client, "http://gw.invalid/files/out.mp4") == VIDEO
    assert seen["authorization"] is None, "API key 走明文 HTTP 发了出去"

    # 再来一格显式非默认端口:两边端口都是 8443,"补默认端口"那行判不出差别,
    # 只有 scheme 比较能拦住。少了这一格,scheme 比较会显得可以删(实际不行)。
    with _authed_client(handler, base_url="https://gw.invalid:8443/v1") as client:
        assert _download(client, "http://gw.invalid:8443/files/out.mp4") == VIDEO
    assert seen["authorization"] is None, "非默认端口上的 https->http 降级没拦住"


def test_relative_result_path_stays_authenticated(monkeypatch):
    """网关返回相对路径时,它解析到网关自己身上,凭证照带。"""
    monkeypatch.setattr("windup_framework.providers.sufy.time.sleep", lambda _: None)
    seen: dict[str, str | None] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        seen["authorization"] = request.headers.get("authorization")
        return httpx.Response(200, content=VIDEO)

    with _authed_client(handler) as client:
        assert _download(client, "files/out.mp4") == VIDEO

    assert seen["url"] == "https://gw.invalid/v1/files/out.mp4"
    assert seen["authorization"] == "Key secret-api-key"


def test_non_http_result_url_is_refused_before_any_request_goes_out(monkeypatch):
    """协议不是 http(s) 就不发请求 —— 地址不对要立刻炸,不是重试三次后报传输错。

    注意 httpx 的边界:只有**带 host** 的绝对地址才保留原 scheme(``ftp://cdn/...``);
    ``file:///etc/passwd`` 这种没有 host 的会被 httpx 当相对地址并入 base_url,
    结果是一个打到网关的 404,不经过这个分支。
    """
    monkeypatch.setattr("windup_framework.providers.sufy.time.sleep", lambda _: None)

    def handler(request: httpx.Request) -> httpx.Response:
        raise AssertionError(f"不该发出任何请求: {request.url}")

    for url in ("ftp://cdn.invalid/out.mp4", "file://cdn.invalid/out.mp4"):
        with _authed_client(handler) as client:
            with pytest.raises(UnsafeDownloadUrlError, match="http"):
                _download(client, url)


# ── 文生图 provider（2026-08-10 实现；此前 gen_image 必抛错而端点可达）──────────


def _img_payload(b64: str) -> dict:
    """模型把图放在 message.content 里，不同网关包裹层级不同。"""
    return {"choices": [{"message": {"content": f"data:image/png;base64,{b64}"}}]}


def _big_b64(n: int = 6000) -> str:
    import base64
    return base64.b64encode(b"\x89PNG" + b"\x00" * n).decode()


# Cloudflare 边缘自己生成 52x 时带的两个头 —— 用来钉"带不带它都一样重发"。
_CF_EDGE = {"cf-ray": "8f2b1c4d5e6a7890-SJC", "server": "cloudflare"}


def _image_provider(handler):
    import httpx

    from windup_framework.config.provider import AIProviderSettings
    from windup_framework.providers.sufy import SufyImageProvider

    p = SufyImageProvider(
        config=AIProviderSettings(base_url="https://gw.example.com/v1", api_key="k"),
    )
    client = httpx.Client(
        base_url="https://gw.example.com/v1",
        headers={"Authorization": "Bearer k"},
        transport=httpx.MockTransport(handler),
    )
    p._client = lambda: client
    return p


def test_image_provider_extends_request_timeout_by_half():
    from windup_framework.config.provider import AIProviderSettings
    from windup_framework.providers.sufy import SufyImageProvider

    provider = SufyImageProvider(
        config=AIProviderSettings(base_url="https://gw.example.com/v1", api_key="k", timeout=20),
    )

    with provider._client() as client:
        assert client.timeout.connect == 30
        assert client.timeout.read == 30
        assert client.timeout.write == 30
        assert client.timeout.pool == 30


def test_submit_image_returns_png_on_200():
    r = _image_provider(lambda req: httpx.Response(200, json=_img_payload(_big_b64()))).submit_image("x", [], "gemini-2.5-flash-image")
    assert r.ok and r.body.startswith(b"\x89PNG")


def test_submit_image_maps_disconnect_to_unreached():
    """对端拆连接且无状态行时不得把异常抛出执行器;Gateway 才能按 UNREACHED 重试。"""

    def h(request):
        raise httpx.RemoteProtocolError("Server disconnected without sending a response")

    r = _image_provider(h).submit_image("x", [], "gemini-2.5-flash-image")
    assert not r.ok
    assert r.error_type is ModelErrorType.UNREACHED
    assert r.http_status is None
    assert r.maybe_billed is False
    assert r.job_id is None
    assert "disconnected" in r.edge_fingerprint


def test_submit_image_sends_the_model_argument():
    seen: dict = {}

    def h(request):
        seen["body"] = json.loads(request.content)
        return httpx.Response(200, json=_img_payload(_big_b64()))

    _image_provider(h).submit_image("x", [], "gemini-override")
    assert seen["body"]["model"] == "gemini-override"


def test_gen_image_returns_the_decoded_png():
    """端点可达而 provider 必抛错 = 每个图像任务稳定 FAILED。实现后必须真能出图。"""
    def h(request):
        import httpx
        return httpx.Response(200, json=_img_payload(_big_b64()))

    data = _image_provider(h).gen_image("a knight", [])
    assert data.startswith(b"\x89PNG") and len(data) > 5000


def test_reference_images_are_sent_as_data_uris():
    """参考图走 content 数组里的 image_url，不是 multipart、不是单独字段。"""
    import json as _json

    seen: dict = {}

    def h(request):
        import httpx
        seen["body"] = _json.loads(request.content)
        return httpx.Response(200, json=_img_payload(_big_b64()))

    _image_provider(h).gen_image("x", [b"\x89PNGref"])
    content = seen["body"]["messages"][0]["content"]
    kinds = [c["type"] for c in content]
    assert kinds == ["text", "image_url"]
    assert content[1]["image_url"]["url"].startswith("data:image/png;base64,")


def test_response_without_an_image_is_invalid_response():
    """2xx 但没有图 → INVALID_RESPONSE，一次 POST，不在 adapter 内连打。"""
    calls = {"n": 0}

    def h(request):
        import httpx
        calls["n"] += 1
        return httpx.Response(200, json={"choices": [{"message": {"content": "抱歉"}}]})

    r = _image_provider(h).submit_image("x", [], "gemini-2.5-flash-image")
    assert calls["n"] == 1
    assert not r.ok
    assert r.error_type is ModelErrorType.INVALID_RESPONSE

    with pytest.raises(RuntimeError, match="未取得有效图"):
        _image_provider(h).gen_image("x", [])


def test_undersized_image_is_rejected_not_returned():
    """响应里可能带一个几十字节的占位串，当图存下去就是打不开的文件。"""
    import base64

    tiny = base64.b64encode(b"\x89PNG" + b"\x00" * 200).decode()
    calls = {"n": 0}

    def h(request):
        import httpx
        calls["n"] += 1
        return httpx.Response(200, json=_img_payload(tiny))

    r = _image_provider(h).submit_image("x", [], "gemini-2.5-flash-image")
    assert calls["n"] == 1
    assert not r.ok
    assert r.error_type is ModelErrorType.INVALID_RESPONSE

    with pytest.raises(RuntimeError, match="字节"):
        _image_provider(h).gen_image("x", [])


def test_first_successful_attempt_is_one_post():
    calls = {"n": 0}

    def h(request):
        import httpx
        calls["n"] += 1
        return httpx.Response(200, json=_img_payload(_big_b64()))

    assert _image_provider(h).gen_image("x", [])
    assert calls["n"] == 1


def test_image_client_retries_connection_failures():
    """本机走代理时建连抖动常见；已跑通的管线实现靠一层网络重试扛住。

    只断言"配了连接重试"这个结构 —— 真去模拟 SSL 握手失败需要一个假 TCP 端点，
    那验的是 httpx 而不是我们的代码。
    """
    from windup_framework.providers.sufy import _CONNECT_RETRIES, SufyImageProvider

    assert _CONNECT_RETRIES >= 1
    client = SufyImageProvider()._client()
    try:
        assert client._transport._pool._retries == _CONNECT_RETRIES
    finally:
        client.close()


def test_image_rate_limit_is_retried_after_retry_after():
    """429 → RATE_LIMIT，解析 Retry-After 进 result；adapter 不 sleep（Gateway 才 sleep）。"""
    calls = {"n": 0}

    def h(request):
        import httpx
        calls["n"] += 1
        return httpx.Response(429, headers={"Retry-After": "0.25"})

    r = _image_provider(h).submit_image("x", [], "gemini-2.5-flash-image")
    assert calls["n"] == 1
    assert r.error_type is ModelErrorType.RATE_LIMIT
    assert r.retry_after_s == 0.25
    assert not r.ok
    assert r.maybe_billed is False


def test_image_rate_limit_exhaustion_has_actionable_error():
    """持续 429 不能泄漏 httpx 异常；adapter 一次一枪，重试留给 Gateway。"""
    calls = {"n": 0}

    def h(request):
        import httpx
        calls["n"] += 1
        return httpx.Response(429, text='{"error":{"message":"quota exceeded"}}')

    r = _image_provider(h).submit_image("x", [], "gemini-2.5-flash-image")
    assert calls["n"] == 1
    assert r.error_type is ModelErrorType.RATE_LIMIT
    assert not r.ok


@pytest.mark.parametrize(
    ("retry_after", "expected"), [("invalid", None), ("NaN", None), ("300", 30.0)]
)
def test_image_rate_limit_wait_has_fallback_and_cap(retry_after, expected):
    def h(request):
        import httpx
        return httpx.Response(429, headers={"Retry-After": retry_after})

    r = _image_provider(h).submit_image("x", [], "gemini-2.5-flash-image")
    assert r.error_type is ModelErrorType.RATE_LIMIT
    assert r.retry_after_s == expected


def test_image_rate_limit_accepts_http_date(monkeypatch):
    calls = {"n": 0}

    def h(request):
        import httpx
        calls["n"] += 1
        return httpx.Response(
            429, headers={"Retry-After": "Thu, 13 Aug 2026 03:00:10 GMT"}
        )

    monkeypatch.setattr(
        "windup_framework.gateway.classify._utc_now",
        lambda: datetime(2026, 8, 13, 3, 0, tzinfo=timezone.utc),
    )

    r = _image_provider(h).submit_image("x", [], "gemini-2.5-flash-image")
    assert calls["n"] == 1
    assert r.error_type is ModelErrorType.RATE_LIMIT
    assert r.retry_after_s == 10.0


def test_retry_after_clock_is_utc():
    assert _utc_now().tzinfo is timezone.utc


def test_retry_after_accepts_date_without_timezone(monkeypatch):
    monkeypatch.setattr(
        "windup_framework.gateway.classify._utc_now",
        lambda: datetime(2026, 8, 13, 3, 0, tzinfo=timezone.utc),
    )

    assert retry_after_seconds("Thu, 13 Aug 2026 03:00:10") == 10.0


def test_request_path_comes_from_config_not_a_literal():
    """路径用配置里的 chat_completions_path —— 它此前零消费方,正是今天在删的那类字段。"""

    seen: dict = {}

    def h(request):
        import httpx
        seen["path"] = request.url.path
        return httpx.Response(200, json=_img_payload(_big_b64()))

    p = _image_provider(h)
    p._cfg = p._cfg.model_copy(update={"chat_completions_path": "/v9/custom-chat"})
    p.gen_image("x", [])
    assert seen["path"].endswith("/v9/custom-chat"), seen["path"]


@pytest.mark.parametrize("headers", [
    pytest.param(_CF_EDGE, id="cloudflare"),
    pytest.param({}, id="no-signal"),
    pytest.param({"server": "APISIX"}, id="apisix"),
    pytest.param({"cf-ray": "8f2b1c4d5e6a7890-SJC", "server": "nginx"}, id="relayed-cf-ray"),
])
@pytest.mark.parametrize("code", [521, 522, 523])
def test_52x_is_classified_unreached_in_one_call(code, headers):
    """判据只看码:``AI_BASE_URL`` 后面挂哪家网关不可知,靠响应头认 Cloudflare 会把真实
    链路上的 52x 全判否(实测网关自报 ``server: APISIX``)。adapter 一次 POST 分类即可。
    """
    calls = {"n": 0}

    def h(request):
        calls["n"] += 1
        return httpx.Response(code, headers=headers, text="Connection timed out")

    r = _image_provider(h).submit_image("x", [], "gemini-2.5-flash-image")
    assert calls["n"] == 1
    assert r.error_type is ModelErrorType.UNREACHED
    assert not r.ok
    assert r.http_status == code
    assert r.maybe_billed is False


@pytest.mark.parametrize("code", [520, 524])
def test_ambiguous_52x_is_never_retried(code):
    """520 / 524 连接已建立、请求可能正在源站处理中,重发就是为同一张图付两次钱。"""
    seen = {"n": 0}

    def h(request):
        seen["n"] += 1
        return httpx.Response(code, headers={"server": "cloudflare"}, text="ambiguous")

    r = _image_provider(h).submit_image("x", [], "gemini-2.5-flash-image")
    assert seen["n"] == 1, f"HTTP {code} 被重试了,会重复计费"
    assert r.error_type is ModelErrorType.MAYBE_BILLED
    assert r.maybe_billed is True
    assert not r.ok


def test_unreached_resends_are_capped_across_the_whole_gen_image():
    """adapter 不再连打 52x；一次 POST + UNREACHED，重发次数由 Gateway 封顶。"""
    calls = {"n": 0}

    def h(request):
        calls["n"] += 1
        return httpx.Response(522, headers={"server": "APISIX"}, text="timed out")

    r = _image_provider(h).submit_image("x", [], "gemini-2.5-flash-image")
    assert calls["n"] == 1
    assert r.error_type is ModelErrorType.UNREACHED


def test_exhausted_retries_report_the_edge_fingerprint():
    """52x 复盘靠边缘指纹，不再依赖「已重发 N 次」异常文本。"""
    def h(request):
        return httpx.Response(522, headers={"server": "APISIX", "cf-ray": "8f2b-SJC"})

    r = _image_provider(h).submit_image("x", [], "gemini-2.5-flash-image")
    assert r.error_type is ModelErrorType.UNREACHED
    assert "server=APISIX" in r.edge_fingerprint
    assert "cf-ray=8f2b-SJC" in r.edge_fingerprint


def test_rate_limit_exhaustion_also_reports_the_fingerprint():
    """限流与「网关连不上上游」要能一眼分开。"""
    calls = {"n": 0}

    def h(request):
        calls["n"] += 1
        return httpx.Response(429, headers={"server": "APISIX"}, text="slow down")

    r = _image_provider(h).submit_image("x", [], "gemini-2.5-flash-image")
    assert calls["n"] == 1
    assert r.error_type is ModelErrorType.RATE_LIMIT
    assert "server=APISIX" in r.edge_fingerprint


def test_unreached_backoff_is_capped():
    """Retry-After 过大时解析结果仍封顶，adapter 不 sleep。"""
    from windup_framework.gateway.classify import _MAX_RETRY_WAIT

    def h(request):
        return httpx.Response(522, headers={**_CF_EDGE, "Retry-After": "9999"})

    r = _image_provider(h).submit_image("x", [], "gemini-2.5-flash-image")
    assert r.error_type is ModelErrorType.UNREACHED
    assert r.retry_after_s == _MAX_RETRY_WAIT


def test_worst_case_request_count_and_wait_are_bounded():
    """adapter 一次一枪，最坏情况就是 1 次 POST。"""
    calls = {"n": 0}

    def h(request):
        calls["n"] += 1
        return httpx.Response(429, text="slow down")

    r = _image_provider(h).submit_image("x", [], "gemini-2.5-flash-image")
    assert calls["n"] == 1
    assert r.error_type is ModelErrorType.RATE_LIMIT


@pytest.mark.parametrize("code", [400, 404])
def test_model_missing_from_the_gateway_catalogue_says_so(code):
    """同一把 key 下不同网关的模型目录不一样(实测:一个 73 个模型零图像模型、
    另一个 134 个含默认模型)。配错 AI_BASE_URL 时错误必须指向配置,不能只是裸 404。
    """
    def h(request):
        import httpx
        return httpx.Response(code, text='{"error":{"message":"model not found"}}')

    r = _image_provider(h).submit_image("x", [], "gemini-2.5-flash-image")
    assert r.error_type is ModelErrorType.MODEL_NOT_FOUND
    assert "/models" in r.edge_fingerprint
    assert r.http_status == code
    assert not r.ok

    with pytest.raises(RuntimeError, match=r"/models"):
        _image_provider(h).gen_image("x", [])


# ── 模型型号可配置（2026-08-11 人工评审：providers 层硬编码太多）───────────────


def _cfg(**kw):
    from windup_framework.config.provider import AIProviderSettings

    return AIProviderSettings(base_url="https://gw.example.com/v1", api_key="k", **kw)


@pytest.mark.parametrize(("cls_name", "field", "value"), [
    ("SufyVideoProvider", "video_model", "kling-v9-test"),
    ("SufyImageProvider", "image_model", "gemini-9-flash-image"),
])
def test_each_provider_reads_its_own_model_field(cls_name, field, value):
    """三条能力同时在用不同模型，所以是三个独立字段而不是共用一个 ``model``。

    共用一个的后果是换其中一条把另外两条也换了 —— 这条用例把"各读各的"钉住：
    只设自己那个字段，另外两个保持默认，断言取到的是自己的。
    """
    import windup_framework.providers.sufy as S

    cls = getattr(S, cls_name)
    assert cls(config=_cfg(**{field: value}))._model == value


def test_explicit_model_argument_still_wins_over_config():
    """显式传参优先于配置 —— A/B 对比时不必改环境变量。"""
    from windup_framework.providers.sufy import SufyImageProvider

    p = SufyImageProvider(config=_cfg(image_model="from-config"), model="from-arg")
    assert p._model == "from-arg"


def test_request_shape_is_not_configurable():
    """**只有型号可配，请求形状不可配。**

    （FAL 队列面已随「从未真实调用过」一并移除，故这里只剩两个型号字段。）

    哪个模型吃 image_list、FAL 队列路径长什么样，是该模型的 API 事实而非运行参数。
    放进配置会把"填错了会怎样"从部署期推到运行期：字段塞错不会立刻报错，任务照常
    queued，直到生成阶段才 failed，而费用可能已经产生（2026-07-29 实测）。

    故断言配置类**没有**这类字段 —— 将来有人想加会先撞到这条用例和它的理由。
    """
    from windup_framework.config.provider import AIProviderSettings

    fields = set(AIProviderSettings.model_fields)
    for banned in ("image_list_models", "fal_endpoints", "first_frame_field"):
        assert banned not in fields, f"{banned} 不该进配置，见本用例 docstring"
    assert {"video_model", "image_model"} <= fields
    assert {"image_fallbacks", "video_fallbacks", "image_unit_cost",
            "video_unit_cost_per_second", "price_version"} <= fields


# ── i2v 主流程（付费路径，此前零覆盖）─────────────────────────────────────────


def _jpeg_first_frame(w: int = 200, h: int = 300) -> bytes:
    """一张竖长的图，用来验首帧被按目标画布补边而不是拉伸。"""
    import io as _io

    from PIL import Image as _Image

    buf = _io.BytesIO()
    _Image.new("RGB", (w, h), (40, 80, 160)).save(buf, "PNG")
    return buf.getvalue()


@pytest.fixture(autouse=True)
def _no_sleep(monkeypatch):
    """轮询里的 time.sleep 打桩 —— 用例不该真等。"""
    import windup_framework.providers.sufy as _S

    monkeypatch.setattr(_S.time, "sleep", lambda *_: None)


def _video_provider(handler, **kw):
    import httpx as _httpx

    from windup_framework.config.provider import AIProviderSettings
    from windup_framework.providers.sufy import SufyVideoProvider

    p = SufyVideoProvider(
        config=AIProviderSettings(base_url="https://gw.example.com/v1", api_key="k"),
        # 轮询预算 = max_min * 60 // poll。poll 取大值让预算只有几次，
        # 再把 time.sleep 打桩掉，用例就既快又不空转（第一版 poll=0.001 配
        # max_min=1 会真轮询 6 万次，单文件跑了 96 秒）。
        poll_interval=30.0,
        **kw,
    )
    # submit_video 与 follow_job 各自 with _client()，必须每次返回新 client，
    # 否则建单结束就会把同一实例 close 掉，跟单 GET 打到已关闭的连接。
    def make_client():
        return _httpx.Client(
            base_url="https://gw.example.com/v1",
            headers={"Authorization": "Bearer k"},
            transport=_httpx.MockTransport(handler),
        )
    p._client = make_client
    return p


def _i2v_handler(seen: dict, *, statuses=("completed",), video=b"MP4DATA" * 200):
    """提交 → 轮询 → 下载 三段式的假网关。"""
    import httpx as _httpx

    calls = {"n": 0}

    def h(request):
        path = request.url.path
        if request.method == "POST" and path.endswith("/videos"):
            seen["body"] = json.loads(request.content)
            return _httpx.Response(200, json={"id": "job-1"})
        if request.method == "GET" and "/videos/" in path:
            i = min(calls["n"], len(statuses) - 1)
            calls["n"] += 1
            st = statuses[i]
            if st == "completed":
                return _httpx.Response(200, json={
                    "status": "completed",
                    "task_result": {"videos": [{"url": "https://gw.example.com/out.mp4"}]},
                })
            return _httpx.Response(200, json={"status": st, "error": "boom"})
        seen["download_headers"] = dict(request.headers)
        return _httpx.Response(200, content=video,
                               headers={"Content-Length": str(len(video))})

    return h


def test_follow_job_records_poll_and_download_timings():
    p = _video_provider(_i2v_handler({}, statuses=("in_progress", "completed")))
    result = p.follow_job("job-1")
    assert result.ok
    assert result.poll_count == 2
    assert isinstance(result.poll_ms, int)
    assert isinstance(result.download_ms, int)


def test_submit_video_maps_disconnect_to_unreached():
    """建单前对端拆连接:无 job_id,Gateway 才能同路重发,而不是冒新单。"""

    def h(request):
        raise httpx.RemoteProtocolError("Server disconnected without sending a response")

    r = _video_provider(h).submit_video(_jpeg_first_frame(), "walk", 5, "1280x720", "kling-v2-5-turbo")
    assert not r.ok
    assert r.error_type is ModelErrorType.UNREACHED
    assert r.http_status is None
    assert r.maybe_billed is False
    assert r.job_id is None
    assert "disconnected" in r.edge_fingerprint


def test_i2v_submits_polls_and_downloads():
    """一条完整的付费路径：提交拿 job id → 轮询到 completed → 下载 mp4。"""
    seen: dict = {}
    data = _video_provider(_i2v_handler(seen)).i2v(_jpeg_first_frame(), "walk right")
    assert data.startswith(b"MP4DATA")
    body = seen["body"]
    assert body["prompt"] == "walk right"
    assert body["seconds"] == "5" and isinstance(body["seconds"], str), "seconds 必须是字符串"
    assert body["mode"] == "std"


def test_first_frame_goes_as_a_jpeg_data_uri():
    """PNG base64 会让任务 status=failed（VENDOR_FAILED，2026-07-22 实测，33s fail-fast）。
    首帧必须转 JPEG —— 这条错在提交后才报，本地看不出来。
    """
    seen: dict = {}
    _video_provider(_i2v_handler(seen)).i2v(_jpeg_first_frame(), "x")
    uri = seen["body"]["input_reference"]
    assert uri.startswith("data:image/jpeg;base64,"), uri[:40]

    import base64 as _b64
    import io as _io

    from PIL import Image as _Image

    im = _Image.open(_io.BytesIO(_b64.b64decode(uri.split(",", 1)[1])))
    assert im.format == "JPEG"


def test_first_frame_is_padded_to_the_target_canvas_not_stretched():
    """按目标画布补边、不拉伸：拉伸会让角色比例变形，而母版比例是角色一致性的一部分。"""
    import base64 as _b64
    import io as _io

    from PIL import Image as _Image

    # 源图放一个偏心的亮块：拉伸会把它拉宽，补边会保持它的宽高比。
    # 只看"对称两点颜色相同"是无效判据 —— 纯色图拉伸后照样相同
    # （2026-08-11 变异测试逮到第一版正是如此，M3 存活）。
    buf = _io.BytesIO()
    src = _Image.new("RGB", (200, 300), (40, 80, 160))
    src.paste((250, 250, 250), (80, 100, 120, 140))      # 40x40 的方块
    src.save(buf, "PNG")

    seen: dict = {}
    _video_provider(_i2v_handler(seen)).i2v(buf.getvalue(), "x", size="1280x720")
    im = _Image.open(_io.BytesIO(_b64.b64decode(seen["body"]["input_reference"].split(",", 1)[1])))
    assert im.size == (1280, 720), "首帧应铺满目标画布"

    # 量那个方块在成品里的宽高比。补边：源 40x40 等比缩放后仍是 1:1。
    # 拉伸：横向被拉 1280/200=6.4 倍、纵向 720/300=2.4 倍，比例变成 ~2.67:1。
    import numpy as _np

    a = _np.asarray(im.convert("L"))
    ys, xs = _np.where(a > 200)
    ratio = (xs.max() - xs.min() + 1) / (ys.max() - ys.min() + 1)
    assert 0.8 < ratio < 1.25, f"方块宽高比 {ratio:.2f}，说明被拉伸了（补边应≈1.0）"


@pytest.mark.parametrize("bad", ["failed", "cancelled"])
def test_terminal_failure_raises_instead_of_polling_to_timeout(bad):
    """网关报 failed/cancelled 要立刻抛，别把剩下的轮询次数耗完 —— 钱已经花了，
    尽快把原因暴露给上层比多等几分钟有用。
    """
    with pytest.raises(RuntimeError, match=bad):
        _video_provider(_i2v_handler({}, statuses=(bad,))).i2v(_jpeg_first_frame(), "x")


def test_never_completing_job_raises_after_the_poll_budget():
    """轮询预算用尽仍未 completed → 抛错，不返回空 bytes。

    返回空 bytes 的话上游会把它当成一段视频送进抽帧，报"视频无可解码帧"，
    真正的原因（超时）就被埋掉了。
    """
    p = _video_provider(_i2v_handler({}, statuses=("in_progress",)), max_min=1)  # 预算 2 次
    with pytest.raises(RuntimeError, match="未取得视频 URL"):
        p.i2v(_jpeg_first_frame(), "x")


def test_image_list_models_use_a_different_first_frame_field():
    """字段按模型选。塞错字段不会立刻报错 —— 任务 status=queued 正常返回，
    直到生成阶段才 failed "model is not supported"，而费用可能已经产生
    （2026-07-29 实测）。
    """
    from windup_framework.providers.sufy import _IMAGE_LIST_MODELS

    seen: dict = {}
    p = _video_provider(_i2v_handler(seen), model=_IMAGE_LIST_MODELS[0], mode="pro")
    p.i2v(_jpeg_first_frame(), "x")
    assert "image_list" in seen["body"] and "input_reference" not in seen["body"]
    assert not seen["body"]["image_list"][0]["image"].startswith("data:"), \
        "image_list 要裸 base64，不带 data URI 前缀"


def test_non_positive_poll_interval_is_rejected_at_construction():
    """轮询间隔 <= 0 在构造时就拒。

    此前会活到 i2v 里 `max_min * 60 // poll` 那一步除零 —— 报 ZeroDivisionError，
    读的人完全看不出是配错了参数（2026-08-11 补 i2v 主流程测试时逮到）。
    0 的语义本身也不成立：那是忙等，会把网关打满。
    """
    from windup_framework.config.provider import AIProviderSettings
    from windup_framework.providers.sufy import SufyVideoProvider

    cfg = AIProviderSettings(base_url="https://gw.example.com/v1", api_key="k")
    for bad in (0, -1, -0.5):
        with pytest.raises(ValueError, match="poll_interval"):
            SufyVideoProvider(config=cfg, poll_interval=bad)


# ── 轮询节奏:先短后长,别每次都睡满一个间隔 ─────────────────────────────────


def test_first_poll_happens_long_before_a_full_interval(monkeypatch):
    """一段 20 秒就绪的视频不该等满 60 秒才被发现。

    线上实测:一次 walk 的轮询段 125.8 秒 / 2 次,第一次就白等了 60 秒。
    """
    import windup_framework.providers.sufy as sufy

    slept: list[float] = []
    monkeypatch.setattr(sufy.time, "sleep", slept.append)

    seen: dict = {}
    p = _video_provider(_i2v_handler(seen, statuses=("processing", "completed")))
    p.i2v(_jpeg_first_frame(), "walk")

    assert slept, "至少要睡过一次"
    assert slept[0] <= 5.0, f"第一次就睡了 {slept[0]} 秒,又是先睡再查"
    assert sum(slept) < 60.0, f"两次查询共睡 {sum(slept)} 秒,不该超过一个完整间隔"


def test_backoff_never_exceeds_the_configured_interval(monkeypatch):
    """退避有上限:慢任务的网关压力不能比原来大。"""
    import windup_framework.providers.sufy as sufy

    slept: list[float] = []
    monkeypatch.setattr(sufy.time, "sleep", slept.append)

    seen: dict = {}
    # _video_provider 固定 poll_interval=30，退避上限即 30。
    p = _video_provider(_i2v_handler(seen, statuses=("processing",) * 12 + ("completed",)))
    p.i2v(_jpeg_first_frame(), "walk")

    assert max(slept) <= 30.0, f"睡了 {max(slept)} 秒,超过了配置的间隔"
    assert slept[-1] == 30.0, "退避到上限后应保持在上限"
    assert slept[0] < slept[-1], "应当是先短后长,而不是一上来就睡满"


def test_non_positive_first_poll_is_rejected_at_construction():
    from windup_framework.config.provider import AIProviderSettings
    from windup_framework.providers.sufy import SufyVideoProvider

    cfg = AIProviderSettings(base_url="https://gw.example.com/v1", api_key="k")
    for bad in (0, -1.0):
        with pytest.raises(ValueError, match="first_poll_after"):
            SufyVideoProvider(config=cfg, first_poll_after=bad)


def _sprite(w: int, h: int, *, alpha: bool, subject_ratio: float = 0.5,
            void_rgb: tuple[int, int, int] = (0, 0, 0)) -> bytes:
    """一张 sprite：正中一块暗色主体，四周是背景。

    ``alpha=True`` 时四周真透明，且透明像素的 RGB 填 ``void_rgb`` —— 透明像素的 RGB 是
    未定义值，测试必须能证明结果不随它变。
    """
    import io as _io

    from PIL import Image as _Image

    sh = max(1, round(h * subject_ratio))
    sw = max(1, round(w * 0.4))
    if alpha:
        im = _Image.new("RGBA", (w, h), (*void_rgb, 0))
        im.paste((10, 10, 10, 255), ((w - sw) // 2, (h - sh) // 2, (w + sw) // 2, (h + sh) // 2))
    else:
        im = _Image.new("RGB", (w, h), (200, 200, 200))
        im.paste((10, 10, 10), ((w - sw) // 2, (h - sh) // 2, (w + sw) // 2, (h + sh) // 2))
    buf = _io.BytesIO()
    im.save(buf, "PNG")
    return buf.getvalue()


def _submitted_first_frame(frame: bytes, size: str = "1280x720"):
    import base64 as _b64
    import io as _io

    from PIL import Image as _Image

    seen: dict = {}
    _video_provider(_i2v_handler(seen)).i2v(frame, "x", size=size)
    uri = seen["body"]["input_reference"]
    return _Image.open(_io.BytesIO(_b64.b64decode(uri.split(",", 1)[1])))


def _subject_height(im) -> int:
    """暗色主体在成品里的高度（像素）。JPEG 会糊边，阈值取宽一点。"""
    import numpy as _np

    a = _np.asarray(im.convert("L"))
    ys, _ = _np.where(a < 90)
    return int(ys.max() - ys.min() + 1) if ys.size else 0


@pytest.mark.parametrize("src_w,src_h", [(64, 64), (128, 128), (256, 256), (200, 300), (400, 200)])
@pytest.mark.parametrize("alpha", [True, False])
def test_small_first_frame_is_enlarged_instead_of_pasted_at_source_size(src_w, src_h, alpha):
    """小于目标画布的输入必须等比放大后再补边，不能原尺寸贴进去。

    只缩不放会把主体的有效分辨率按 (源边长/画布边长) 砍掉:128x128 贴进 1280x720 只占
    13% 高,之后 i2v 与重抠图都补不回来（#509）。判据取"主体占内容区高度的比例"而不是
    绝对像素:它对画布尺寸与长宽比都成立,且正是用户看到的那个量。
    """
    W, H, ratio = 1280, 720, 0.5
    im = _submitted_first_frame(_sprite(src_w, src_h, alpha=alpha, subject_ratio=ratio))
    assert im.size == (W, H)

    scale = min(W / src_w, H / src_h)
    content_h = round(src_h * scale)
    got = _subject_height(im)
    assert abs(got - ratio * content_h) <= 0.08 * content_h, (
        f"{src_w}x{src_h} alpha={alpha}: 主体 {got}px，内容区高 {content_h}px，"
        f"期望约 {ratio * content_h:.0f}px；只缩不放会得到约 {ratio * src_h:.0f}px"
    )
    # 与"不拉伸"是两条独立约束：放大到了也可能是拉伸放大的。
    assert scale > 1, "本用例的输入都小于画布，否则测不到放大"


def test_transparent_first_frame_background_does_not_depend_on_undefined_rgb():
    """透明像素的 RGB 是未定义值，直接 ``convert("RGB")`` 会把它当真。

    抠图后透明区的 RGB 恰好是 0，于是视频输入静默变成黑底；换个抠图实现就换个底色。
    合成规则必须是声明出来的常量，且同一 alpha、不同未定义 RGB 必须给出同一张图。
    """
    import numpy as _np

    from windup_framework.providers.sufy import _FIRST_FRAME_BG

    black_void = _submitted_first_frame(_sprite(256, 256, alpha=True, void_rgb=(0, 0, 0)))
    red_void = _submitted_first_frame(_sprite(256, 256, alpha=True, void_rgb=(255, 0, 0)))

    corner = _np.asarray(black_void)[4, 4]
    assert _np.allclose(corner, _FIRST_FRAME_BG, atol=12), f"角落底色 {corner}，应为声明的 {_FIRST_FRAME_BG}"
    assert not _np.allclose(corner, (0, 0, 0), atol=12), "透明背景又变成黑底了"

    diff = _np.abs(_np.asarray(black_void, dtype=float) - _np.asarray(red_void, dtype=float))
    assert diff.max() <= 12, f"未定义 RGB 换个值就产出不同图像（最大差 {diff.max()}）"


def test_opaque_first_frame_keeps_sampling_its_own_corner_for_padding():
    """不透明输入的补边色沿用角点色 —— 强行改成固定底色会在画面与补边之间造出一条缝。"""
    import numpy as _np

    im = _submitted_first_frame(_sprite(256, 256, alpha=False))
    corner = _np.asarray(im)[4, 4]
    assert _np.allclose(corner, (200, 200, 200), atol=12), f"补边色 {corner}，应沿用源图角点色"


def test_square_first_frame_forms_a_720x720_content_region_in_a_1280x720_canvas():
    """方形输入在 1280x720 里应是 720x720 的等比内容区，左右各补 280px。

    与"主体占幅"是两条判据:主体占幅对了也可能是内容区偏了(比如贴在角上)。
    源图最外一圈填成不透明亮色,内容区边界才量得到 —— 补边色与合成底色相同,
    只看底色是量不出边界的。
    """
    import io as _io

    import numpy as _np
    from PIL import Image as _Image

    src = _Image.new("RGBA", (256, 256), (0, 0, 0, 0))
    src.paste((240, 240, 240, 255), (0, 0, 256, 256))
    src.paste((10, 10, 10, 255), (60, 60, 196, 196))      # 内部暗块，避免整幅纯色
    buf = _io.BytesIO()
    src.save(buf, "PNG")

    im = _submitted_first_frame(buf.getvalue())
    a = _np.asarray(im.convert("L"))
    cols = _np.where((a > 200).any(axis=0))[0]
    rows = _np.where((a > 200).any(axis=1))[0]
    assert 715 <= cols.max()-cols.min()+1 <= 725, f"内容区宽 {cols.max()-cols.min()+1}，应≈720"
    assert 715 <= rows.max()-rows.min()+1 <= 725, f"内容区高 {rows.max()-rows.min()+1}，应≈720"
    assert abs(cols.min() - 280) <= 4, f"内容区左边界 {cols.min()}，应≈280（左右各补 280）"
