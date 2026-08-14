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

from windup_framework.providers.sufy import (
    IncompleteDownloadError,
    UnsafeDownloadUrlError,
    _download,
    _retry_after_seconds,
    _utc_now,
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


def test_response_without_an_image_is_retried_then_raises():
    """模型偶发返回一条不含图的正常响应。重试后仍拿不到必须抛，不能返回空 bytes——
    上游会把返回值直接上传对象存储并写进任务结果，0 字节的"成功"就是用户看到的裂图。"""
    import pytest

    calls = {"n": 0}

    def h(request):
        import httpx
        calls["n"] += 1
        return httpx.Response(200, json={"choices": [{"message": {"content": "抱歉"}}]})

    with pytest.raises(RuntimeError, match="未取得有效图"):
        _image_provider(h).gen_image("x", [])
    assert calls["n"] == 3, "应重试到上限而不是一次就放弃"


def test_undersized_image_is_rejected_not_returned():
    """响应里可能带一个几十字节的占位串，当图存下去就是打不开的文件。"""
    import base64

    import pytest

    tiny = base64.b64encode(b"\x89PNG" + b"\x00" * 200).decode()

    def h(request):
        import httpx
        return httpx.Response(200, json=_img_payload(tiny))

    with pytest.raises(RuntimeError, match="字节"):
        _image_provider(h).gen_image("x", [])


def test_first_successful_attempt_stops_retrying():
    calls = {"n": 0}

    def h(request):
        import httpx
        calls["n"] += 1
        if calls["n"] == 1:
            return httpx.Response(200, json={"choices": [{"message": {"content": "空"}}]})
        return httpx.Response(200, json=_img_payload(_big_b64()))

    assert _image_provider(h).gen_image("x", [])
    assert calls["n"] == 2


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


def test_image_rate_limit_is_retried_after_retry_after(monkeypatch):
    """429 表示请求未被网关接收，按 Retry-After 退避后应继续当前图片任务。"""
    calls = {"n": 0}
    sleeps: list[float] = []

    def h(request):
        import httpx
        calls["n"] += 1
        if calls["n"] == 1:
            return httpx.Response(429, headers={"Retry-After": "0.25"})
        return httpx.Response(200, json=_img_payload(_big_b64()))

    monkeypatch.setattr("windup_framework.providers.sufy.time.sleep", sleeps.append)

    assert _image_provider(h).gen_image("x", [])
    assert calls["n"] == 2
    assert sleeps == [0.25]


def test_image_rate_limit_exhaustion_has_actionable_error(monkeypatch):
    """持续 429 不能泄漏 httpx 异常，也不能无限重试。"""
    calls = {"n": 0}

    def h(request):
        import httpx
        calls["n"] += 1
        return httpx.Response(429, text='{"error":{"message":"quota exceeded"}}')

    monkeypatch.setattr("windup_framework.providers.sufy.time.sleep", lambda _: None)

    with pytest.raises(RuntimeError, match="稍后重试或检查服务商额度"):
        _image_provider(h).gen_image("x", [])
    assert calls["n"] == 3


@pytest.mark.parametrize(
    ("retry_after", "expected"), [("invalid", 2.0), ("NaN", 2.0), ("300", 30.0)]
)
def test_image_rate_limit_wait_has_fallback_and_cap(monkeypatch, retry_after, expected):
    calls = {"n": 0}
    sleeps: list[float] = []

    def h(request):
        import httpx
        calls["n"] += 1
        if calls["n"] == 1:
            return httpx.Response(429, headers={"Retry-After": retry_after})
        return httpx.Response(200, json=_img_payload(_big_b64()))

    monkeypatch.setattr("windup_framework.providers.sufy.time.sleep", sleeps.append)

    assert _image_provider(h).gen_image("x", [])
    assert sleeps == [expected]


def test_image_rate_limit_accepts_http_date(monkeypatch):
    calls = {"n": 0}
    sleeps: list[float] = []

    def h(request):
        import httpx
        calls["n"] += 1
        if calls["n"] == 1:
            return httpx.Response(
                429, headers={"Retry-After": "Thu, 13 Aug 2026 03:00:10 GMT"}
            )
        return httpx.Response(200, json=_img_payload(_big_b64()))

    monkeypatch.setattr(
        "windup_framework.providers.sufy._utc_now",
        lambda: datetime(2026, 8, 13, 3, 0, tzinfo=timezone.utc),
    )
    monkeypatch.setattr("windup_framework.providers.sufy.time.sleep", sleeps.append)

    assert _image_provider(h).gen_image("x", [])
    assert sleeps == [10.0]


def test_retry_after_clock_is_utc():
    assert _utc_now().tzinfo is timezone.utc


def test_retry_after_accepts_date_without_timezone(monkeypatch):
    monkeypatch.setattr(
        "windup_framework.providers.sufy._utc_now",
        lambda: datetime(2026, 8, 13, 3, 0, tzinfo=timezone.utc),
    )

    assert _retry_after_seconds("Thu, 13 Aug 2026 03:00:10") == 10.0


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
def test_52x_is_retried_whatever_the_edge_looks_like(monkeypatch, code, headers):
    """判据只看码:``AI_BASE_URL`` 后面挂哪家网关不可知,靠响应头认 Cloudflare 会把真实
    链路上的 52x 全判否(实测网关自报 ``server: APISIX``),整条重试等于不存在。
    """
    calls = {"n": 0}

    def h(request):
        calls["n"] += 1
        if calls["n"] <= 2:
            return httpx.Response(code, headers=headers, text="Connection timed out")
        return httpx.Response(200, json=_img_payload(_big_b64()))

    monkeypatch.setattr("windup_framework.providers.sufy.time.sleep", lambda _: None)
    assert _image_provider(h).gen_image("x", []).startswith(b"\x89PNG")
    assert calls["n"] == 3, "必须真的重发，而不是靠外层出图循环碰运气"


@pytest.mark.parametrize("code", [520, 524])
def test_ambiguous_52x_is_never_retried(code):
    """520 / 524 连接已建立、请求可能正在源站处理中,重发就是为同一张图付两次钱。"""
    seen = {"n": 0}

    def h(request):
        seen["n"] += 1
        return httpx.Response(code, headers={"server": "cloudflare"}, text="ambiguous")

    with pytest.raises(httpx.HTTPStatusError):
        _image_provider(h).gen_image("x", [])
    assert seen["n"] == 1, f"HTTP {code} 被重试了,会重复计费"


def test_retryable_set_excludes_the_codes_that_may_have_billed():
    """常量本身也钉一道:改集合的人不必先读懂 _post 才发现自己开了重复计费的洞。"""
    from windup_framework.providers.sufy import _CLOUDFLARE_UNREACHED_STATUS

    assert _CLOUDFLARE_UNREACHED_STATUS == {521, 522, 523}


def test_unreached_resends_are_capped_across_the_whole_gen_image(monkeypatch):
    """52x 的"没到上游"是大概率不是保证(CF 的 522 含"连上了但源站没及时确认"),
    所以可重复计费的重发次数按整次 gen_image 封顶,不跟着内外两层循环叠乘。
    """
    from windup_framework.providers.sufy import _UNREACHED_RESENDS

    calls = {"n": 0}

    def h(request):
        calls["n"] += 1
        if calls["n"] % 2:
            return httpx.Response(522, headers={"server": "APISIX"}, text="timed out")
        return httpx.Response(200, json={"choices": [{"message": {"content": "无图"}}]})

    monkeypatch.setattr("windup_framework.providers.sufy.time.sleep", lambda _: None)

    with pytest.raises(RuntimeError, match=r"已重发 2 次"):
        _image_provider(h).gen_image("x", [])
    # 预算若按 _post 调用各算一份,外层三轮就会重发 3 次而不是 2 次。
    assert calls["n"] == 2 * _UNREACHED_RESENDS + 1


def test_exhausted_retries_report_the_edge_fingerprint(monkeypatch):
    """三次全 52x 正是最需要复盘的场景,而它唯一留下的就是这条异常文本。"""
    def h(request):
        return httpx.Response(522, headers={"server": "APISIX", "cf-ray": "8f2b-SJC"})

    monkeypatch.setattr("windup_framework.providers.sufy.time.sleep", lambda _: None)

    with pytest.raises(RuntimeError, match=r"522.*已重发 2 次.*server=APISIX"):
        _image_provider(h).gen_image("x", [])


def test_rate_limit_exhaustion_also_reports_the_fingerprint(monkeypatch):
    """限流与"网关连不上上游"要能一眼分开 —— 两者的处置完全不同。"""
    from windup_framework.providers.sufy import _POST_TRIES

    calls = {"n": 0}

    def h(request):
        calls["n"] += 1
        return httpx.Response(429, headers={"server": "APISIX"}, text="slow down")

    monkeypatch.setattr("windup_framework.providers.sufy.time.sleep", lambda _: None)

    with pytest.raises(RuntimeError, match=r"过于频繁.*连发 3 次.*server=APISIX"):
        _image_provider(h).gen_image("x", [])
    assert calls["n"] == _POST_TRIES


def test_unreached_backoff_is_capped(monkeypatch):
    """上游挂掉时不该把一个图像任务堵成长时间阻塞。"""
    from windup_framework.providers.sufy import _MAX_RETRY_WAIT

    sleeps: list[float] = []

    def h(request):
        return httpx.Response(522, headers={**_CF_EDGE, "Retry-After": "9999"})

    monkeypatch.setattr("windup_framework.providers.sufy.time.sleep", sleeps.append)

    with pytest.raises(RuntimeError, match="522"):
        _image_provider(h).gen_image("x", [])
    assert sleeps and max(sleeps) <= _MAX_RETRY_WAIT


def test_worst_case_request_count_and_wait_are_bounded(monkeypatch):
    """内外两层重试会叠乘,最坏情况必须是个说得出的数,而不是"看情况"。"""
    from windup_framework.providers.sufy import _IMAGE_TRIES, _MAX_RETRY_WAIT, _POST_TRIES

    calls = {"n": 0}
    sleeps: list[float] = []

    def h(request):
        calls["n"] += 1
        if calls["n"] % _POST_TRIES:
            return httpx.Response(429, text="slow down")
        return httpx.Response(200, json={"choices": [{"message": {"content": "无图"}}]})

    monkeypatch.setattr("windup_framework.providers.sufy.time.sleep", sleeps.append)

    with pytest.raises(RuntimeError, match="均未取得有效图"):
        _image_provider(h).gen_image("x", [])
    assert calls["n"] == _IMAGE_TRIES * _POST_TRIES == 9
    assert sum(sleeps) <= _IMAGE_TRIES * (_POST_TRIES - 1) * _MAX_RETRY_WAIT


@pytest.mark.parametrize("code", [400, 404])
def test_model_missing_from_the_gateway_catalogue_says_so(code):
    """同一把 key 下不同网关的模型目录不一样(实测:一个 73 个模型零图像模型、
    另一个 134 个含默认模型)。配错 AI_BASE_URL 时错误必须指向配置,不能只是裸 404。
    """
    def h(request):
        import httpx
        return httpx.Response(code, text='{"error":{"message":"model not found"}}')

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
    client = _httpx.Client(
        base_url="https://gw.example.com/v1",
        headers={"Authorization": "Bearer k"},
        transport=_httpx.MockTransport(handler),
    )
    p._client = lambda: client
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
