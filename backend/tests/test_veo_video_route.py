"""veo3.1 接进视频链路:开关、烧钱三项、首帧 URL、以及轮询走哪条协议面。

这一面每一条失败的形态都不是报错,是**照常出片、照常计费**:
时长走默认 8s、音轨走默认 true、首帧塞 base64 到生成阶段才 failed。
所以这里断言的全是"请求体里到底写了什么",不是"调用有没有成功"。
"""
from __future__ import annotations

import io

import httpx
import pytest

from windup_common.enums.model import ModelErrorType
from windup_framework.config.provider import AIProviderSettings
from windup_framework.gateway.registry import (
    FAMILIES,
    VIDEO_UNIT_COST_USD_PER_SECOND,
    ModelRegistry,
    RegistryError,
)
from windup_framework.gateway.trace import estimate_cost
from windup_framework.gateway.types import Family, Scene
from windup_framework.providers.protocol import OpenAIVideoProtocol, VideoRequest
from windup_framework.providers.protocol.fal_queue import (
    VEO_ENDPOINT,
    VeoQueueVideoProtocol,
    VeoSpendGuardError,
    _assert_spend_pinned,
    veo_aspect_ratio,
    veo_duration,
)
from windup_framework.providers.sufy import SufyVideoProvider

BASE_URL = "https://api.qnaigc.com/v1"
ROOT = "https://api.qnaigc.com"
FRAME_URL = "https://media.windup.xin/media/action-frame/deadbeef.jpg"
REQUEST_ID = "qvideo-1382244847-1787504690896902712"


def _png(size: tuple[int, int] = (64, 64)) -> bytes:
    from PIL import Image

    buf = io.BytesIO()
    Image.new("RGBA", size, (200, 30, 30, 255)).save(buf, "PNG")
    return buf.getvalue()


def _req(*, size: str = "1280x720", seconds: int = 5, url: str | None = FRAME_URL) -> VideoRequest:
    return VideoRequest(
        model="veo3.1", prompt="向右走", seconds=seconds, size=size, mode="std",
        first_frame=_png(), first_frame_url=url,
    )


def _veo() -> VeoQueueVideoProtocol:
    return VeoQueueVideoProtocol("k-123", base_url=BASE_URL)


def _cfg(**kw) -> AIProviderSettings:
    kw.setdefault("video_model", "kling-v2-5-turbo")
    return AIProviderSettings(image_model="gpt-image-2", **kw)


class _Uploader:
    """记下"传上去的是哪几个字节",好断言传的是补过边的首帧而不是原始母版。"""

    def __init__(self, url: str = FRAME_URL) -> None:
        self.url = url
        self.seen: list[tuple[bytes, str]] = []

    def upload(self, first_frame: bytes, content_type: str) -> str:
        self.seen.append((first_frame, content_type))
        return self.url


def _provider(handler, *, uploader=None, model="veo3.1") -> SufyVideoProvider:
    """把 provider 的 httpx.Client 换成 MockTransport —— 不联网、不花钱。"""
    cfg = AIProviderSettings(base_url=BASE_URL, api_key="k-123", video_model=model)
    provider = SufyVideoProvider(config=cfg, model=model, poll_interval=0.01,
                                 first_poll_after=0.01, uploader=uploader)
    provider._client = lambda: httpx.Client(  # type: ignore[method-assign]
        base_url=BASE_URL,
        headers={"Authorization": f"Bearer {cfg.api_key}"},
        transport=httpx.MockTransport(handler),
    )
    return provider


# ── 开关 ────────────────────────────────────────────────────────────────────


def test_veo_is_registered_but_never_enters_the_automatic_chain():
    """拦的坏例:让按用户授权的型号当兜底。

    链是**兜底路径**,谁的任务都可能落到它上面。veo 按用户授权、按秒计费且比 kling 贵,
    一旦进链,没被授权的用户也会在兜底那一跳用上它 —— 客户看不出区别,账单上是另一档价。
    所以 ``FAMILIES`` 里有它(认识)与它能被用(放行)必须是两回事,而且放行**只走请求显式指定**。
    """
    assert FAMILIES["veo3.1"] is Family.VIDEO_FAL_QUEUE
    chain = ModelRegistry.from_settings(_cfg(video_fallbacks="veo3.1")).chain(
        Scene.CHARACTER_ACTION
    )
    assert chain == ("kling-v2-5-turbo",)


def test_veo_stays_out_of_the_chain_even_with_users_allowlisted():
    """白名单只放行"这个人能显式指定它",不等于把它放进兜底链。

    两者混为一谈的话,给一个人开权限 = 给所有人开兜底。
    """
    chain = ModelRegistry.from_settings(
        _cfg(video_fallbacks="veo3.1", video_veo_user_ids="7,12")
    ).chain(Scene.CHARACTER_ACTION)
    assert chain == ("kling-v2-5-turbo",)


def test_a_kling_only_deployment_is_not_broken_by_the_user_gate():
    """拦的坏例:受限型号被滤掉时连累整条视频链。"""
    r = ModelRegistry.from_settings(_cfg(video_fallbacks="veo3.1,kling-v2-6"))
    assert r.chain(Scene.CHARACTER_ACTION) == ("kling-v2-5-turbo", "kling-v2-6")


def test_a_chain_made_only_of_user_gated_models_raises_instead_of_going_silent():
    """把**唯一**的型号配成按用户授权的型号 → 空链。

    静默返回空链的话,第一次真实调用才炸,而那时的错误长得像"网关挂了"。
    """
    with pytest.raises(RegistryError, match="不能当兜底"):
        ModelRegistry.from_settings(_cfg(video_model="veo3.1", video_fallbacks=""))


def test_allowlist_is_empty_by_default_so_nobody_can_use_veo():
    """默认谁都不能用 —— 忘配 = 关着,而不是忘配 = 开着。"""
    from windup_framework.gateway.registry import is_allowed_for_user

    assert AIProviderSettings().video_veo_user_ids == ""
    assert is_allowed_for_user("veo3.1", 7, _cfg()) is False


def test_allowlist_admits_only_the_listed_users():
    """拦的坏例:白名单写了等于对所有人开放。"""
    from windup_framework.gateway.registry import is_allowed_for_user

    cfg = _cfg(video_veo_user_ids="7, 12")
    assert is_allowed_for_user("veo3.1", 7, cfg) is True
    assert is_allowed_for_user("veo3.1", 12, cfg) is True
    assert is_allowed_for_user("veo3.1", 8, cfg) is False
    assert is_allowed_for_user("veo3.1", None, cfg) is False
    # 非受限型号不受影响
    assert is_allowed_for_user("kling-v2-5-turbo", 8, cfg) is True


def test_malformed_allowlist_entries_are_skipped_not_treated_as_wildcard():
    """拦的坏例:配置写坏就变成对所有人开放。

    ``"all"`` / ``"*"`` / 空串这类写法必须是"谁都不放",而不是"谁都放" ——
    两个方向的代价不对称。
    """
    from windup_framework.gateway.registry import is_allowed_for_user

    for raw in ("all", "*", " , ", "7x"):
        assert is_allowed_for_user("veo3.1", 7, _cfg(video_veo_user_ids=raw)) is False


def test_resolve_video_model_rejects_veo_for_a_user_not_on_the_list(monkeypatch):
    """编排层的拒绝 —— 任务被重排 / 重投时绕过 HTTP 边界的那条路。"""
    from windup_app.server.orchestrator import executor

    monkeypatch.setattr(
        "windup_framework.gateway.registry.default_settings",
        _cfg(video_fallbacks="veo3.1", video_veo_user_ids="7"),
    )
    with pytest.raises(ValueError, match="未对当前用户开放"):
        executor._resolve_video_model("veo3.1", 8)
    assert executor._resolve_video_model("veo3.1", 7) == "veo3.1"


def test_resolve_video_model_without_a_user_rejects_veo(monkeypatch):
    """拿不到用户时必须拒 —— 默认放行会让任何漏传 user_id 的路径变成后门。"""
    from windup_app.server.orchestrator import executor

    monkeypatch.setattr(
        "windup_framework.gateway.registry.default_settings",
        _cfg(video_fallbacks="veo3.1", video_veo_user_ids="7"),
    )
    with pytest.raises(ValueError, match="未对当前用户开放"):
        executor._resolve_video_model("veo3.1")


# ── 烧钱的三项 ──────────────────────────────────────────────────────────────


def test_request_body_pins_duration_audio_and_resolution():
    """拦的坏例:靠上游默认值。

    三项一起漏 = 8s + 有声 = 4s 无声那档的 4 倍价,而任务照常成功、没有一道会红。
    """
    body = _veo().build_submit(_req()).body
    assert body["duration"] == "4s"
    assert body["generate_audio"] is False
    assert body["resolution"] == "720p"
    assert body["aspect_ratio"] in ("16:9", "9:16")


def test_duration_carries_the_second_suffix_unlike_kling():
    """拦的坏例:把 kling 的时长形状抄过来。

    kling 是 ``"5"``(无后缀)、veo 是 ``"8s"``(带后缀)。形状写混不会被立刻拒,
    会静默走错档 —— 两个字段同叫 ``duration``,肉眼看不出来。
    """
    veo_body = _veo().build_submit(_req()).body
    kling_body = OpenAIVideoProtocol("k-123").build_submit(
        VideoRequest(model="kling-v2-5-turbo", prompt="p", seconds=5,
                     size="1280x720", mode="std", first_frame=_png())
    ).body
    assert veo_body["duration"] == "4s" and veo_body["duration"].endswith("s")
    assert kling_body["seconds"] == "5" and not kling_body["seconds"].endswith("s")


def test_duration_rounds_down_never_up():
    """向上取档 = 替用户多花钱。链上恒为 seconds=5,落在 4s 与 6s 之间。"""
    assert veo_duration(5) == "4s"
    assert veo_duration(4) == "4s"
    assert veo_duration(8) == "8s"
    assert veo_duration(1) == "4s"      # 比最小档还小时取最便宜的一档,不是拒绝


def test_spend_guard_catches_a_dropped_generate_audio_line():
    """拦的坏例:将来某次重构把 ``generate_audio`` 那一行删掉。

    删掉之后没有任何既有断言会红 —— 上游拿默认 true 照样出片,只是价钱翻倍。
    """
    body = {"duration": "4s", "aspect_ratio": "16:9", "resolution": "720p"}
    with pytest.raises(VeoSpendGuardError, match="generate_audio"):
        _assert_spend_pinned(body)


def test_spend_guard_catches_a_dropped_duration_line():
    """同上,漏掉时上游默认 8s —— 最贵的一档。"""
    body = {"generate_audio": False, "aspect_ratio": "16:9", "resolution": "720p"}
    with pytest.raises(VeoSpendGuardError, match="duration"):
        _assert_spend_pinned(body)


def test_square_canvas_is_rejected_before_spending():
    """拦的坏例:veo 不吃 1:1,让它自己去猜等于用一次已计费的生成来试错。"""
    with pytest.raises(VeoSpendGuardError, match="1:1"):
        veo_aspect_ratio("720x720")
    with pytest.raises(VeoSpendGuardError):
        _veo().build_submit(_req(size="720x720"))


def test_aspect_ratio_follows_the_first_frame_canvas():
    """画幅与首帧不一致时,上游要么裁掉角色要么再补一次边 —— 都要等成片出来才看得见。"""
    assert veo_aspect_ratio("720x1280") == "9:16"
    assert veo_aspect_ratio("1280x720") == "16:9"
    assert _veo().build_submit(_req(size="720x1280")).body["aspect_ratio"] == "9:16"


# ── 首帧只走公网 URL ────────────────────────────────────────────────────────


def test_first_frame_goes_out_as_public_url_not_base64():
    """拦的坏例:塞 base64。

    归档实测:FAL 面塞 base64 会先 ``status=queued``、到生成阶段才 ``failed``,
    而费用可能已经产生 —— 失败得晚且要收钱,是这条路最贵的一种错法。
    """
    body = _veo().build_submit(_req()).body
    assert body["image_url"].startswith(("http://", "https://"))
    assert not body["image_url"].startswith("data:")


def test_missing_first_frame_url_is_refused_at_build_time():
    """没有 URL 就必须拒建单,不能退回 base64 那条路。"""
    with pytest.raises(VeoSpendGuardError, match="公网 URL"):
        _veo().build_submit(_req(url=None))


def test_provider_without_uploader_sends_nothing_and_bills_nothing():
    """拦的坏例:漏注入 uploader 时先把请求发出去再失败。

    这一步还没碰上游,``maybe_billed`` 必须是 False —— 记成可能已计费会让账面
    凭空多出没发生的花费,也会让本可以直接重试的失败不敢重发。
    """
    sent: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        sent.append(request)
        return httpx.Response(200, json={"request_id": REQUEST_ID})

    result = _provider(handler, uploader=None).submit_video(
        _png(), "向右走", 5, "1280x720", "veo3.1"
    )
    assert sent == []
    assert result.ok is False
    assert result.maybe_billed is False
    assert result.error_type is ModelErrorType.UNREACHED


def test_uploader_gets_the_fitted_first_frame_not_the_raw_master():
    """传原图会让"我们声明的画幅"和"上游实际看到的图"对不上。"""
    from PIL import Image

    uploader = _Uploader()
    provider = _provider(
        lambda r: httpx.Response(200, json={"request_id": REQUEST_ID}), uploader=uploader
    )
    provider.submit_video(_png((64, 64)), "向右走", 5, "1280x720", "veo3.1")

    assert len(uploader.seen) == 1
    blob, content_type = uploader.seen[0]
    assert content_type == "image/jpeg"
    assert Image.open(io.BytesIO(blob)).size == (1280, 720)


def test_kling_still_goes_out_as_data_uri_on_the_openai_face():
    """veo 这条线不许改动 kling 的行为 —— 它至今是产品线上唯一在跑的视频型号。"""
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json={"id": "job-1"})

    provider = _provider(handler, uploader=_Uploader(), model="kling-v2-5-turbo")
    provider.submit_video(_png(), "向右走", 5, "1280x720", "kling-v2-5-turbo")

    assert len(seen) == 1
    assert seen[0].url.path.endswith("/videos")
    assert seen[0].headers["Authorization"].startswith("Bearer ")
    import json as _json

    body = _json.loads(seen[0].content)
    assert body["input_reference"].startswith("data:image/jpeg;base64,")


# ── 轮询走哪条面 ────────────────────────────────────────────────────────────


def test_submit_uses_the_queue_path_with_key_auth():
    """路径与 ``/v1`` 平级、鉴权是 ``Key`` 不是 ``Bearer`` —— 两条都不能靠拼字符串猜。"""
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json={"request_id": REQUEST_ID})

    _provider(handler, uploader=_Uploader()).submit_video(
        _png(), "向右走", 5, "1280x720", "veo3.1"
    )
    assert str(seen[0].url) == f"{ROOT}/queue/{VEO_ENDPOINT}"
    assert seen[0].headers["Authorization"] == "Key k-123"


def test_inspect_job_takes_the_second_hop_and_normalizes_completed():
    """拦的坏例:拿 kling 那条面去查 veo 的单。

    两处会静默错:① FAL 的状态是大写 ``COMPLETED``,而 follow_job / poll_i2v 都按小写
    ``completed`` 判就绪 —— 不归一化就会一直被当成"还在跑",转满预算才报超时,
    而视频早就生成好、钱早就花了;② FAL 的 ``/status`` 不带产物地址,要再取一次。
    """
    paths: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        paths.append(request.url.path)
        if request.url.path.endswith("/status"):
            return httpx.Response(200, json={"status": "COMPLETED"})
        return httpx.Response(200, json={"video": {"url": "https://cdn.invalid/x.mp4"}})

    snap = _provider(handler).inspect_job(REQUEST_ID, "veo3.1")
    assert paths == [
        f"/queue/fal-ai/veo3.1/requests/{REQUEST_ID}/status",
        f"/queue/fal-ai/veo3.1/requests/{REQUEST_ID}",
    ]
    assert snap.ok is True
    assert snap.job_status == "completed"
    assert snap.edge_fingerprint == "https://cdn.invalid/x.mp4"


def test_inspect_job_without_a_model_falls_back_to_the_openai_face():
    """不传型号时形状必须保持原样 —— kling 的既有调用点没有型号可传。"""
    paths: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        paths.append(request.url.path)
        return httpx.Response(200, json={"status": "processing"})

    _provider(handler).inspect_job("job-1")
    assert paths == ["/v1/videos/job-1"]   # 相对路径经 base_url 拼出来,仍是 OpenAI 面


def test_poll_i2v_carries_the_model_down_to_the_adapter():
    """拦的坏例:异步轮询丢掉型号。

    建单与轮询是两条消息、隔着一个延迟队列。型号早就随 job 存进了 Redis,
    但此前没往下传 —— veo 的单在另一条路径上,不传就是 404,而钱已经花了。
    """
    from windup_framework.gateway.types import AdapterResult
    from windup_framework.gateway.video import VideoGateway

    seen: dict = {}

    class _Adapter:
        def inspect_job(self, job_id, model=None):
            seen.update(job_id=job_id, model=model)
            return AdapterResult(ok=False, job_id=job_id)

    gw = VideoGateway(
        ModelRegistry.from_settings(_cfg()), _Adapter(), object(), _cfg()
    )
    gw.poll_i2v("j-1", model="veo3.1")
    assert seen == {"job_id": "j-1", "model": "veo3.1"}


def test_i2v_poll_reads_the_model_out_of_the_saved_state(monkeypatch):
    """同一条链的 app 端:存进 Redis 的型号要真的被读出来往下传。"""
    import time

    from windup_app.server.orchestrator import i2v_poll

    monkeypatch.setattr(
        i2v_poll, "load_i2v_state",
        lambda task_id: {
            "job_id": "j1", "poll_count": 0, "next_wait": 5.0,
            "started_at": time.time(), "route_id": "primary", "model": "veo3.1",
        },
    )
    monkeypatch.setattr(i2v_poll, "schedule", lambda *a, **kw: None)
    seen: dict = {}

    def poll_video(job_id, *, route_id=None, model=None):
        seen.update(job_id=job_id, route_id=route_id, model=model)
        return None

    i2v_poll.inspect(1, poll_video=poll_video)
    assert seen == {"job_id": "j1", "route_id": "primary", "model": "veo3.1"}


# ── 记账 ────────────────────────────────────────────────────────────────────


def test_veo_cost_is_dollars_per_second_at_the_silent_tier():
    """拦的坏例:把人民币填进这张表,或按有声档记。

    ``ledger`` 把非空 cost 一律标 ``USD``,填人民币会让成本整体错一个汇率;
    而有声是 $0.40/秒,按它记会把账面翻一倍。4s 无声 = $0.80 一条。
    """
    assert VIDEO_UNIT_COST_USD_PER_SECOND["veo3.1"] == 0.20
    assert estimate_cost(
        Scene.CHARACTER_ACTION, billed=True, seconds=4, model="veo3.1"
    ) == pytest.approx(0.80)


def test_veo_is_billed_by_the_tier_it_actually_buys_not_the_seconds_asked_for():
    """拦的坏例:按调用方要的 5 秒记账,而 veo 只卖 4/6/8 三档、实际落在 4s。

    照 5 秒记会让每条 veo 的账面多出 25%,而这个偏差随档位变化,事后无法回补。
    链上恒为 seconds=5,所以这条差异是**每一条 veo 都会踩到**,不是边角情形。
    """
    assert veo_duration(5) == "4s"
    assert estimate_cost(
        Scene.CHARACTER_ACTION, billed=True, seconds=5, model="veo3.1"
    ) == pytest.approx(0.80)


def test_kling_video_cost_still_falls_back_to_the_configured_rate():
    """表里没有的型号行为不变 —— 这张表是新增的,不该改动 kling 的记账。"""
    assert estimate_cost(
        Scene.CHARACTER_ACTION, billed=True, seconds=5, model="kling-v2-5-turbo"
    ) is None
    assert estimate_cost(
        Scene.CHARACTER_ACTION, billed=True, seconds=5,
        video_unit_cost_per_second=0.1, model="kling-v2-5-turbo",
    ) == pytest.approx(0.5)
