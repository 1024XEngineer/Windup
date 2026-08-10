"""Provider 接口的 SUFY / qnaigc(Modelink 网关)同步实现。

网关上挂着**两套互不兼容的视频接口面**,本模块两条都实现、并存不替换:

1. OpenAI 风格(:class:`SufyVideoProvider`)——首帧走 base64 dataURI::

     POST /v1/videos {model, prompt, size, seconds, mode, input_reference}
     轮询 GET /v1/videos/{id} → status==completed → task_result.videos[0].url → 下载 mp4

   2026-07-27 对 kling-v2-5-turbo 端到端实测到 completed。留着是因为没有实测证据说它
   坏了,sora 系可能仍只在这一面。

2. FAL 队列(:class:`FalQueueVideoProvider`)——首帧走**公网 URL**::

     POST /queue/{厂商}/{型号}/[{mode}/]image-to-video {..., image_url|start_image_url}
     轮询 GET /queue/{家族}/requests/{request_id}/status → COMPLETED → result.video.url

   2026-08-07 拉网关 OpenAPI spec 逐个核对:平台现有 69 个 POST 视频端点,其中 22 个
   图生视频**全部**在这一面,全部要 URL 形态的首帧字段,没有一个吃 dataURI。

两面鉴权也不同(spec 明写):FAL 面 ``Authorization: Key {api_key}``,OpenAI 面 ``Bearer``。

key / base_url 由 ``AIProviderSettings`` 注入,provider 内不读 env。
重依赖(PIL)惰性导入,保证模块导入零成本。
"""
from __future__ import annotations

import base64
import io
import json
import logging
import re
import time
from collections.abc import Mapping
from dataclasses import dataclass, field

import httpx

from windup_framework.config.provider import AIProviderSettings, settings

from .interfaces import FirstFrameUploader, ImageProvider, VideoProvider

logger = logging.getLogger("windup.providers.sufy")

# 只有 kling-video-o1 走 image_list;v2 系列 / sora 走 input_reference(字段按模型选,塞错任务会 failed)。
_IMAGE_LIST_MODELS = ("kling-video-o1",)
DEFAULT_VIDEO_MODEL = "kling-v2-5-turbo"


def _fit_first_frame(frame: bytes, size: str) -> bytes:
    """首帧 bytes → 等比缩放 + 背景色补边到目标尺寸 → JPG(RGB,q90) bytes。

    不强拉到目标尺寸(母版多为横幅,强压成方会把角色压成瘦长鬼影);JPG 因 PNG base64
    会 VENDOR_FAILED(实测)。

    这一步同时是 kling 系"输出画幅"的唯一控制点:kling 的 i2v 端点没有 resolution/size
    字段,成片画幅跟随首帧,所以 ``size`` 只能在这里生效。
    """
    from PIL import Image

    w, h = (int(x) for x in size.split("x"))
    im = Image.open(io.BytesIO(frame)).convert("RGB")
    pad = im.getpixel((0, 0))
    fitted = im.copy()
    fitted.thumbnail((w, h), Image.LANCZOS)
    canvas = Image.new("RGB", (w, h), pad)
    canvas.paste(fitted, ((w - fitted.width) // 2, (h - fitted.height) // 2))
    buf = io.BytesIO()
    canvas.save(buf, "JPEG", quality=90)
    return buf.getvalue()


def _first_frame_datauri(frame: bytes, size: str) -> str:
    """首帧 → base64 dataURI(OpenAI 风格 ``/v1/videos`` 面专用;FAL 面不吃 dataURI)。"""
    return "data:image/jpeg;base64," + base64.b64encode(_fit_first_frame(frame, size)).decode()


class SufyVideoProvider(VideoProvider):
    """kling i2v(默认 v2-5-turbo)。首帧 + 动作 prompt → mp4 bytes。"""

    def __init__(
        self,
        config: AIProviderSettings = settings,
        model: str = DEFAULT_VIDEO_MODEL,
        mode: str = "std",
        poll_interval: float = 60.0,
        max_min: int = 30,
    ) -> None:
        self._cfg = config
        self._model = model
        self._mode = mode
        self._poll = poll_interval
        self._max_min = max_min

    def _client(self) -> httpx.Client:
        return httpx.Client(
            base_url=self._cfg.normalized_base_url,
            headers={"Authorization": f"Bearer {self._cfg.api_key}"},
            timeout=self._cfg.timeout,
        )

    def i2v(
        self, first_frame: bytes, prompt: str, seconds: int = 5, size: str = "1280x720"
    ) -> bytes:
        body: dict = {
            "model": self._model,
            "prompt": prompt,
            "size": size,
            "seconds": str(seconds),
            "mode": self._mode,
        }
        if self._model in _IMAGE_LIST_MODELS:
            b64 = _first_frame_datauri(first_frame, size).split(",", 1)[1]
            body["image_list"] = [{"image": b64}]
        else:
            body["input_reference"] = _first_frame_datauri(first_frame, size)

        with self._client() as client:
            job = client.post("/videos", json=body).raise_for_status().json()
            jid = job.get("id")
            url = None
            for _ in range(max(1, int(self._max_min * 60 // self._poll))):
                time.sleep(self._poll)
                st = client.get(f"/videos/{jid}").raise_for_status().json()
                status = st.get("status")
                if status == "completed":
                    vids = (st.get("task_result") or {}).get("videos") or []
                    url = vids[0].get("url") if vids else None
                    break
                if status in ("failed", "cancelled"):
                    raise RuntimeError(f"i2v 失败: {status} — {st.get('error')}")
            if not url:
                raise RuntimeError("i2v 未取得视频 URL(超时或失败)")
            return _download(client, url)


class IncompleteDownloadError(RuntimeError):
    """视频下载到的字节数与 ``Content-Length`` 不符。"""


class UnsafeDownloadUrlError(RuntimeError):
    """成品 URL 的协议不是 http(s) —— 不下载。

    这个 URL 来自网关响应,是外部输入。直接丢给 httpx 去 GET 一个 ``file://`` / ``data:``
    只会在重试三次之后报一个跟协议无关的传输错,不如在这里就说清是地址不对。
    """


def _same_origin(url: httpx.URL, other: httpx.URL) -> bool:
    """同源判定(scheme + host + 端口,默认端口按 scheme 补齐)。

    语义对齐 httpx 自己在跨源重定向时摘凭证用的 ``Client._redirect_headers``;
    没直接 import 它的私有 ``_same_origin``,免得被上游改名。

    "默认端口补齐"这一步在 httpx 0.28 下其实判不出新差别(它已把 ``:443`` / ``:80``
    归一化成 ``port is None``,2026-08-10 变异测试确认单独拆掉这行无用例失败)。留着的理由
    是与 httpx 保持同一套判据:一旦上游不再归一化,少了它 ``https://gw`` 与 ``https://gw:443``
    就成了跨源,会把该带的凭证摘掉、把同源下载打成 401。
    """
    default = {"http": 80, "https": 443}
    return (
        url.scheme == other.scheme
        and url.host == other.host
        and (url.port or default.get(url.scheme)) == (other.port or default.get(other.scheme))
    )


def _download_request(client: httpx.Client, url: str) -> httpx.Request:
    """构造成品下载请求;目标不在网关同源时,把 client 级凭证摘掉。

    为什么必须摘(2026-08-10 机器审提出):成品 URL 是**网关响应里的绝对地址**,正常情况
    指向 CDN 域名,异常情况可以是网关返回的任意地址。而 httpx 只在跨源**重定向**时才自动
    摘 Authorization,对这种一开始就跨源的直连请求,client 级 headers 会原样带过去 ——
    于是 ``Authorization: Bearer/Key <api_key>`` 被发给了那个域名,等于把 API key 交出去。

    同源时保留凭证:网关也可能签发自己域名下的下载链接,那条路径摘了头就是 401。
    所以按目标地址判定,不是一律摘、也不是一律留。
    """
    request = client.build_request("GET", url)
    if request.url.scheme not in ("http", "https"):
        raise UnsafeDownloadUrlError(f"成品 URL 必须是 http(s),收到 {str(request.url)!r}")
    if not _same_origin(request.url, client.base_url):
        # 只摘目标域名不该看到的:Proxy-Authorization 是给代理的,与目标是否同源无关,别动它。
        request.headers.pop("Authorization", None)
        request.headers.pop("Cookie", None)
    return request


def _download(client: httpx.Client, url: str, tries: int = 3) -> bytes:
    """下载已生成好的视频,带重试 + 长度校验。

    为什么单次读取不够(2026-08-05 实测,同一角色连续两单复现):原实现是
    ``client.get(url).raise_for_status().content``。**视频此时已经生成、费用已经产生**,
    只要读 body 时连接断一次,整单就废::

        peer closed connection without sending complete message body
        (received 720450 bytes, expected 929531)

    重试是安全的:这是对成品 URL 的 GET,幂等且不再计费——**代价是一次重下,
    不重试的代价是一次重新生成**。

    长度校验是因为截断不一定抛异常:服务端提前关流而客户端已收到部分 body 时,
    ``.content`` 可能直接返回短 bytes,那样坏视频会一路流到出帧环节才暴露,
    在那里看起来像"解码失败",很难回溯到这里。``Content-Length`` 缺失(分块传输)时跳过校验。

    凭证处理见 :func:`_download_request`。请求在进循环之前就构造好:地址不合法要在
    发出任何一次请求之前炸,而不是重试三次之后。
    """
    request = _download_request(client, url)
    last: Exception | None = None
    for attempt in range(tries):
        try:
            # send 不会再合并 client 级 headers(build_request 时已合并过),
            # 所以上面摘掉的 Authorization 不会被重新加回来。
            response = client.send(request)
            response.raise_for_status()
            body = response.content
            expected = response.headers.get("content-length")
            if expected and len(body) != int(expected):
                raise IncompleteDownloadError(f"视频下载不完整: {len(body)}/{expected} 字节")
            return body
        except (httpx.HTTPError, IncompleteDownloadError) as exc:
            last = exc
            if attempt < tries - 1:
                time.sleep(2**attempt)
    raise RuntimeError(f"视频下载失败(已重试 {tries} 次): {last}") from last


# ── FAL 队列面 ──────────────────────────────────────────────────────────────
# 2026-08-07 拉网关 OpenAPI spec 核对得到:平台的 22 个图生视频端点全在 /queue/ 下,
# 首帧字段一律是 URL 形态(image_url / start_image_url),同日实测送 dataURI 无一能用。
# (spec 里 seedance / vidu-q3 / kling-v3-turbo 三家的字段说明写着"URL 或 base64",
#  与实测冲突,未复验。本实现一律只发公网 URL —— 那是 22 个端点的共同解。)
#
# 每家有三样东西不一样,而且**没有一条能靠拼字符串猜出来**,所以下面是一张硬表:
#   1. 提交路径:型号段各不相同(o3 / v3 / v3/turbo / v2.6 / v2.5-turbo / o1),
#      有的带 {mode} 路径参数、有的不带(veo / seedance / minimax / vidu 不带)。
#   2. 首帧字段名:同是 kling,o3 与 v2.5-turbo 叫 image_url,v3 / v2.6 / o1 却叫
#      start_image_url。塞错字段 = 送了图但模型没收到。
#   3. 轮询前缀:**不是**提交路径加个 /requests。kling 六个型号共用一个
#      /queue/fal-ai/kling-video/requests/{id},型号段与 mode 段都不出现。
#      这一条是最容易想当然拼错的地方。
#
# 另有两处形态差异也写进表里,因为取值形式不同会被网关 400:
#   - 时长字段都叫 duration,但取值分三种形态:"5"(kling/seedance)、"8s"(veo)、
#     5(minimax/vidu,整数)。
#   - 分辨率:kling 系**没有**这个字段(成片画幅跟随首帧,所以 size 只能靠补边生效);
#     其余各家的档位枚举各不相同。


class UnknownVideoModelError(RuntimeError):
    """模型不在端点表里 —— 不猜路径,直接拒。

    猜错的代价不对称:猜出一条不存在的路径只是 404(便宜),猜出一条**存在但语义不同**
    的路径(如把 image-to-video 猜成 reference-to-video)会正常出片、正常计费,
    产出却与预期不符。故这里只认表,不做前缀匹配、不做拼接兜底。
    """


class UnsupportedVideoOptionError(RuntimeError):
    """该模型不支持这个 mode / 时长 / 画幅 —— 提交前就拒,别等网关 400。"""


class FirstFrameNotPublicError(RuntimeError):
    """uploader 没给出 http(s) URL —— 首帧供应商取不到。"""


class VideoJobFailedError(RuntimeError):
    """FAL 任务失败。

    含一种伪装成功:spec 明写「任务失败时后端也返回 COMPLETED,通过 detail 字段区分」。
    只看 status 会把失败当成功,然后在"取不到视频 URL"处报一个莫名其妙的错。
    """


class VideoJobTimeoutError(RuntimeError):
    """轮询预算耗尽仍未出片(任务可能还在跑,费用可能已产生)。"""


@dataclass(frozen=True)
class FalI2VEndpoint:
    """一个模型在 FAL 队列面上的调用形状。字段全部取自网关 OpenAPI spec。"""

    submit_path: str  # 含 {mode} 则该模型必须给 mode
    image_field: str  # image_url / start_image_url
    queue_base: str  # 轮询与取结果的前缀,与 submit_path 不同
    seconds: frozenset[int]  # 允许的时长
    modes: frozenset[str] = frozenset()  # 空 = 路径里没有 {mode}
    duration_style: str = "str"  # str -> "5" | str_s -> "8s" | int -> 5
    resolution_field: str | None = None  # None = 该模型没有分辨率档位,画幅跟随首帧
    resolutions: Mapping[int, str] = field(default_factory=dict)  # 首帧高度 → 档位枚举
    audio_field: str | None = None  # 有则显式关掉:序列帧不要声音,别平白多花钱


_KLING_QUEUE = "/queue/fal-ai/kling-video"
_KLING_3_SECONDS = frozenset(range(3, 16))

# 键是**本仓自己的模型名**(与 ``AIProviderSettings.model`` 对齐)。FAL 面的 body 里
# 没有 model 字段 —— 型号是路径的一部分,这也是"必须查表"的根本原因。
FAL_I2V_ENDPOINTS: Mapping[str, FalI2VEndpoint] = {
    "kling-v3-omni": FalI2VEndpoint(
        submit_path=f"{_KLING_QUEUE}/o3/{{mode}}/image-to-video",
        image_field="image_url",
        queue_base=_KLING_QUEUE,
        seconds=_KLING_3_SECONDS,
        modes=frozenset({"standard", "std", "pro", "4k"}),
        audio_field="generate_audio",
    ),
    "kling-v3": FalI2VEndpoint(
        submit_path=f"{_KLING_QUEUE}/v3/{{mode}}/image-to-video",
        image_field="start_image_url",  # 与同族 o3 的 image_url 不同,别顺手写成一样
        queue_base=_KLING_QUEUE,
        seconds=_KLING_3_SECONDS,
        modes=frozenset({"standard", "std", "pro", "4k"}),
        audio_field="generate_audio",  # spec 默认 true
    ),
    "kling-v3-turbo": FalI2VEndpoint(
        submit_path=f"{_KLING_QUEUE}/v3/turbo/{{mode}}/image-to-video",
        image_field="image_url",
        queue_base=_KLING_QUEUE,
        seconds=_KLING_3_SECONDS,
        modes=frozenset({"standard", "pro"}),  # 注意没有 "std"
    ),
    "kling-v2-6": FalI2VEndpoint(
        submit_path=f"{_KLING_QUEUE}/v2.6/{{mode}}/image-to-video",
        image_field="start_image_url",
        queue_base=_KLING_QUEUE,
        seconds=frozenset({5, 10}),
        modes=frozenset({"pro"}),  # 只有 pro
        audio_field="generate_audio",  # spec 默认 true
    ),
    "kling-v2-5-turbo": FalI2VEndpoint(
        submit_path=f"{_KLING_QUEUE}/v2.5-turbo/{{mode}}/image-to-video",
        image_field="image_url",
        queue_base=_KLING_QUEUE,
        seconds=frozenset({5, 10}),
        modes=frozenset({"standard", "std", "pro"}),
    ),
    "kling-video-o1": FalI2VEndpoint(
        submit_path=f"{_KLING_QUEUE}/o1/{{mode}}/image-to-video",
        image_field="start_image_url",
        queue_base=_KLING_QUEUE,
        seconds=frozenset(range(3, 11)),
        modes=frozenset({"standard", "std", "pro"}),
    ),
    "veo3.1": FalI2VEndpoint(
        submit_path="/queue/fal-ai/veo3.1/image-to-video",
        image_field="image_url",
        queue_base="/queue/fal-ai/veo3.1",
        seconds=frozenset({4, 6, 8}),
        duration_style="str_s",  # 只有 veo 带 "s" 后缀
        resolution_field="resolution",
        resolutions={720: "720p", 1080: "1080p", 2160: "4k"},
        audio_field="generate_audio",  # spec 默认 true
    ),
    "seedance-2.0": FalI2VEndpoint(
        submit_path="/queue/bytedance/seedance-2.0/image-to-video",
        image_field="image_url",
        queue_base="/queue/bytedance/seedance-2.0",
        seconds=frozenset(range(4, 16)),
        resolution_field="resolution",
        resolutions={480: "480p", 720: "720p", 1080: "1080p", 2160: "4k"},
        audio_field="generate_audio",
    ),
    "minimax-h3": FalI2VEndpoint(
        submit_path="/queue/minimax/h3/image-to-video",
        image_field="image_url",
        queue_base="/queue/minimax/h3",
        seconds=frozenset(range(5, 16)),
        duration_style="int",
        resolution_field="resolution",
        # 只有 768P / 2K 两档。720 高的首帧没有对应档位,此时**报错而不是就近选 768P**:
        # 悄悄换档 = 出片尺寸与调用方要的不一致,而序列帧下游是按尺寸对齐的。
        resolutions={768: "768P"},
    ),
    "vidu-q3-pro": FalI2VEndpoint(
        submit_path="/queue/fal-ai/vidu/q3/image-to-video/pro",
        image_field="image_url",
        queue_base="/queue/fal-ai/vidu",  # 家族级前缀,不含 q3/pro
        seconds=frozenset(range(1, 17)),
        duration_style="int",
        resolution_field="resolution",
        resolutions={540: "540p", 720: "720p", 1080: "1080p"},
        audio_field="audio",  # q3 默认 true
    ),
}

DEFAULT_FAL_VIDEO_MODEL = "kling-v2-5-turbo"


def fal_endpoint(model: str) -> FalI2VEndpoint:
    """查表取端点定义;查不到就炸,绝不猜。"""
    try:
        return FAL_I2V_ENDPOINTS[model]
    except KeyError:
        known = ", ".join(sorted(FAL_I2V_ENDPOINTS))
        raise UnknownVideoModelError(
            f"模型 {model!r} 不在 FAL 图生视频端点表里。已登记: {known}。"
            "新增模型请去网关 OpenAPI spec 抄提交路径 / 首帧字段名 / 轮询前缀三项后登记,不要拼路径。"
        ) from None


def fal_submit_path(model: str, mode: str) -> str:
    """拼出提交路径(唯一允许的"拼接"就是把表里的 {mode} 填上)。"""
    endpoint = fal_endpoint(model)
    if not endpoint.modes:
        return endpoint.submit_path
    if mode not in endpoint.modes:
        raise UnsupportedVideoOptionError(
            f"模型 {model} 不支持 mode={mode!r},可选: {sorted(endpoint.modes)}"
        )
    return endpoint.submit_path.format(mode=mode)


def assert_i2v_options(model: str, seconds: int, size: str) -> None:
    """把"这个模型收不收这些参数"验完。纯计算,故可在**上传首帧之前**先调。"""
    endpoint = fal_endpoint(model)
    if seconds not in endpoint.seconds:
        raise UnsupportedVideoOptionError(
            f"模型 {model} 不支持 {seconds} 秒,可选: {sorted(endpoint.seconds)}"
        )
    if endpoint.resolution_field:
        _fal_resolution(model, endpoint, size)


def fal_i2v_body(model: str, prompt: str, image_url: str, seconds: int, size: str) -> dict:
    """按模型形态组装请求体。任何一项不被该模型支持都当场炸,不做就近替换。"""
    assert_i2v_options(model, seconds, size)
    endpoint = fal_endpoint(model)
    # 10 个端点的时长字段都叫 duration,只是取值形态不同。
    body: dict = {
        endpoint.image_field: image_url,
        "prompt": prompt,
        "duration": _fal_duration(model, endpoint, seconds),
    }
    if endpoint.resolution_field:
        body[endpoint.resolution_field] = _fal_resolution(model, endpoint, size)
    if endpoint.audio_field:
        # 序列帧不要声音:多数端点默认 true,不显式关掉等于白付音轨的钱和时间。
        body[endpoint.audio_field] = False
    return body


def _fal_duration(model: str, endpoint: FalI2VEndpoint, seconds: int) -> str | int:
    if endpoint.duration_style == "int":
        return int(seconds)
    if endpoint.duration_style == "str_s":
        return f"{seconds}s"
    if endpoint.duration_style == "str":
        return str(seconds)
    raise UnsupportedVideoOptionError(
        f"模型 {model} 的 duration_style 登记有误: {endpoint.duration_style!r}"
    )


def _fal_resolution(model: str, endpoint: FalI2VEndpoint, size: str) -> str:
    try:
        height = int(size.split("x")[1])
    except (IndexError, ValueError):
        raise UnsupportedVideoOptionError(f"size 形如 1280x720,收到 {size!r}") from None
    try:
        return endpoint.resolutions[height]
    except KeyError:
        raise UnsupportedVideoOptionError(
            f"模型 {model} 没有 {size} 对应的分辨率档位,支持的高度: {sorted(endpoint.resolutions)}"
        ) from None


def _api_root(base_url: str) -> str:
    """把 OpenAI 兼容面的 base_url 退回网关根。

    配置里的 ``AI_BASE_URL`` 指向 OpenAI 面(``.../v1``),而 FAL 的 ``/queue/...`` 与
    ``/v1/...`` 是**平级**的(spec 的 servers 就是裸域名)。直接拿 base_url 拼会得到
    ``/v1/queue/...`` → 404。
    """
    root = base_url.rstrip("/")
    return root[: -len("/v1")] if root.endswith("/v1") else root


class PreUploadedFirstFrame(FirstFrameUploader):
    """首帧已经在公网上时的零成本 uploader(不传任何东西,直接返回该 URL)。

    典型场景:server 侧的母版本来就存在 ``Character.reference_image_url``,重新上传一份
    纯属浪费。

    **代价写在这里,别踩**:走这条路等于跳过 :func:`_fit_first_frame` 的补边,
    ``i2v(size=...)`` 对 kling 系就失效了(kling 没有分辨率字段,成片画幅跟随首帧)。
    要控制成片画幅,请给一个真正会上传 bytes 的 uploader。
    """

    def __init__(self, url: str) -> None:
        if not url.startswith(("http://", "https://")):
            raise FirstFrameNotPublicError(f"首帧 URL 必须是 http(s),收到 {url!r}")
        self._url = url

    def upload(self, frame: bytes, content_type: str) -> str:
        """两个入参是 port 契约的一部分,本实现用不上(图已经在公网)。"""
        return self._url


class FalQueueVideoProvider(VideoProvider):
    """FAL 队列面的 i2v。首帧 bytes → 经 uploader 换成公网 URL → 队列任务 → mp4 bytes。

    与 :class:`SufyVideoProvider` 并存:那条是 OpenAI 风格 ``/v1/videos``(首帧走
    dataURI),两套接口面在网关上同时存在,路径 / 鉴权 / 首帧形态全都不同。

    ``uploader`` 是**必填**且无默认值 —— 构造不出一个"没有上传能力的 FAL provider",
    免得跑到线上才发现首帧送不出去(那时任务已经提交、钱已经花了)。
    """

    def __init__(
        self,
        uploader: FirstFrameUploader,
        config: AIProviderSettings = settings,
        model: str = DEFAULT_FAL_VIDEO_MODEL,
        mode: str = "std",
        poll_interval: float = 15.0,
        max_min: int = 30,
    ) -> None:
        # 构造即校验:未知模型 / 不支持的 mode 在**花钱之前**就炸掉。
        self._path = fal_submit_path(model, mode)
        self._endpoint = fal_endpoint(model)
        self._uploader = uploader
        self._cfg = config
        self._model = model
        self._mode = mode
        self._poll = poll_interval
        self._max_min = max_min

    def _client(self) -> httpx.Client:
        return httpx.Client(
            base_url=_api_root(self._cfg.normalized_base_url),
            # FAL 面是 ``Key``,不是 ``Bearer``(spec 的 securitySchemes 里两套并列写明)。
            headers={"Authorization": f"Key {self._cfg.api_key}"},
            timeout=self._cfg.timeout,
        )

    def i2v(
        self, first_frame: bytes, prompt: str, seconds: int = 5, size: str = "1280x720"
    ) -> bytes:
        # 先验参数再上传:上传首帧通常要花钱/占带宽,不该为一个必然被拒的请求先传图。
        assert_i2v_options(self._model, seconds, size)
        body = fal_i2v_body(self._model, prompt, self._upload(first_frame, size), seconds, size)
        with self._client() as client:
            request_id = _fal_submit(client, self._path, body)
            url = _await_fal_video_url(
                client, self._endpoint, request_id, self._poll, self._max_min
            )
            # 重试与长度校验是 2026-08-05 实测挣来的,不为"看起来更干净"去动它。
            # 但凭证不跟着走:成品 URL 多是 CDN 绝对地址,跨源时 _download 会摘掉
            # Authorization(见 _download_request —— 原来那句"用同一个 client 带鉴权头取"
            # 就是 2026-08-10 机器审报的 key 泄漏)。
            return _download(client, url)

    def _upload(self, first_frame: bytes, size: str) -> str:
        url = self._uploader.upload(_fit_first_frame(first_frame, size), "image/jpeg")
        if not isinstance(url, str) or not url.startswith(("http://", "https://")):
            # dataURI / 本地路径在这一面必然产不出正确结果:要么被网关 400,要么更糟 ——
            # 被当成"没有首帧"跑成文生视频,照样计费。宁可在提交前炸。
            raise FirstFrameNotPublicError(
                f"uploader 必须返回 http(s) 公网 URL(供应商服务器要能取到),收到 {url!r}"
            )
        return url


def _fal_submit(client: httpx.Client, path: str, body: dict) -> str:
    """提交任务,拿 request_id。被拒时把网关的 detail.msg 带出来(否则只剩一个 400)。"""
    try:
        payload = client.post(path, json=body).raise_for_status().json()
    except httpx.HTTPStatusError as exc:
        raise VideoJobFailedError(
            f"i2v 提交被拒(HTTP {exc.response.status_code},POST {path}): {_fal_error_text(exc.response)}"
        ) from exc
    request_id = payload.get("request_id")
    if not request_id:
        raise VideoJobFailedError(f"i2v 提交返回里没有 request_id: {payload}")
    return str(request_id)


def _fal_error_text(response: httpx.Response) -> str:
    try:
        detail = response.json().get("detail")
    except ValueError:
        return response.text[:200]
    if isinstance(detail, dict):
        return str(detail.get("msg") or detail)
    return str(detail)


def _await_fal_video_url(
    client: httpx.Client,
    endpoint: FalI2VEndpoint,
    request_id: str,
    poll_interval: float,
    max_min: int,
) -> str:
    """轮询到出片,返回成品视频 URL。任何非成功终态都抛错,绝不返回空。

    三处踩点:
      - 进行中的状态是 HTTP 202,``raise_for_status`` 不会拦,得看 status 字段。
      - spec 明写「任务失败时后端也返回 COMPLETED,通过 detail 字段区分成功/失败」,
        所以 COMPLETED 还要再看 detail —— 只认 status 会把失败当成功。
      - 认不出的 status 一律当失败,不要 continue:那会一直转到超时,把一个"协议变了"
        的问题伪装成"生成太慢"。
    """
    status_path = f"{endpoint.queue_base}/requests/{request_id}/status"
    for _ in range(max(1, int(max_min * 60 // poll_interval))):
        time.sleep(poll_interval)
        state = client.get(status_path).raise_for_status().json()
        status = str(state.get("status") or "")
        if status in ("IN_QUEUE", "IN_PROGRESS"):
            continue
        if status == "FAILED":
            raise VideoJobFailedError(f"i2v 任务失败({request_id}): {state.get('detail')}")
        if status != "COMPLETED":
            raise VideoJobFailedError(f"i2v 任务返回未知状态 {status!r}({request_id}): {state}")
        if state.get("detail"):
            raise VideoJobFailedError(
                f"i2v 任务 COMPLETED 但带 detail = 实为失败({request_id}): {state.get('detail')}"
            )
        url = ((state.get("result") or {}).get("video") or {}).get("url")
        return url if url else _fal_result_url(client, endpoint, request_id)
    raise VideoJobTimeoutError(
        f"i2v 轮询 {max_min} 分钟仍未出片({request_id});任务可能仍在跑,费用可能已产生"
    )


def _fal_result_url(client: httpx.Client, endpoint: FalI2VEndpoint, request_id: str) -> str:
    """COMPLETED 但状态响应里没带 URL 时,按 fal 协议再取一次结果。

    不是兜底降级,是协议本身就有的第二步(提交响应里的 ``response_url`` 指的就是它):
    各家 status 响应是否内联 result 并不一致。此时**视频已生成、费用已产生**,
    为少一次 GET 而丢掉整单不划算。取不到才炸。
    """
    path = f"{endpoint.queue_base}/requests/{request_id}"
    try:
        payload = client.get(path).raise_for_status().json()
    except httpx.HTTPError as exc:
        raise VideoJobFailedError(f"i2v 已完成但取结果失败({request_id}): {exc}") from exc
    url = (payload.get("video") or {}).get("url")
    if not url:
        raise VideoJobFailedError(f"i2v 已完成但结果里没有视频 URL({request_id}): {payload}")
    return str(url)


DEFAULT_IMAGE_MODEL = "gemini-2.5-flash-image"

# "调用成功但没返回有效图"的重试次数。与 _download 的网络重试是两码事:那个治连接断,
# 这个治模型返回了一条不含图的正常响应(实测偶发)。也是为什么下面要判 base64 长度 ——
# 返回里可能带一个几十字节的占位串,当图存下去就是一个打不开的文件。
_IMAGE_TRIES = 3
_MIN_IMAGE_BYTES = 5000
_CONNECT_RETRIES = 3

# 从响应里捞 data URI。模型把图放在 message.content 里,而不同网关的包裹层级不一样
# (有的 content 是字符串、有的是 parts 数组),故对整个响应 JSON 做一次正则,
# 不去猜层级 —— 猜错的代价是"调用成功、费用已产生、但我们说没图"。
_DATA_URI = re.compile(r"data:image/[^;]+;base64,([A-Za-z0-9+/=]{100,})")


class SufyImageProvider(ImageProvider):
    """文生图 / 图生图 provider(OpenAI 兼容的 ``/chat/completions`` 面)。

    调用形状与 i2v 那两个 provider 完全不同:图像走 chat 接口、参考图以 data URI 塞进
    ``content`` 数组,没有提交-轮询-下载三段式。

    2026-08-10 修:此前 ``gen_image`` 直接抛 NotImplementedError,而
    ``POST /generation/image`` 端点是可达的、``ImageTaskExecutor`` 又默认实例化本类 ——
    于是每个图像任务都稳定走到 FAILED。端点看着可用、实际必失败,正是本仓最忌讳的形态
    (机器审逮到)。实现取自管线仓已跑通的通路(同日用它出过三张角色母版)。
    """

    def __init__(
        self,
        config: AIProviderSettings = settings,
        model: str = DEFAULT_IMAGE_MODEL,
    ) -> None:
        self._cfg = config
        self._model = model

    def _client(self) -> httpx.Client:
        return httpx.Client(
            base_url=self._cfg.normalized_base_url,
            headers={"Authorization": f"Bearer {self._cfg.api_key}"},
            timeout=self._cfg.timeout,
            # retries 只覆盖建连阶段的失败(SSL 握手、连接被重置)。本机走代理时这类抖动
            # 常见,已跑通的管线实现正是靠一层网络重试扛住的;不加会在人家能恢复的地方
            # 放弃。它不重试读超时与 5xx —— 那两种请求可能已达上游,重发会重复计费。
            transport=httpx.HTTPTransport(retries=_CONNECT_RETRIES),
        )

    def gen_image(self, prompt: str, refs: list[bytes]) -> bytes:
        """提示词 + 参考图 → 一张 PNG bytes。拿不到有效图就抛,不返回空 bytes。

        为什么不返回空 bytes 兜底:上游 ``ImageTaskExecutor`` 会把返回值直接上传对象存储
        并写进任务结果,一个 0 字节的"成功"会变成用户看到的一张裂图。
        """
        content: list[dict] = [{"type": "text", "text": prompt}]
        for raw in refs:
            b64 = base64.b64encode(raw).decode()
            content.append({
                "type": "image_url",
                "image_url": {"url": f"data:image/png;base64,{b64}"},
            })
        body = {"model": self._model, "messages": [{"role": "user", "content": content}]}

        last = ""
        with self._client() as client:
            for attempt in range(1, _IMAGE_TRIES + 1):
                payload = client.post(
                    "/chat/completions", json=body,
                ).raise_for_status().json()
                found = _DATA_URI.search(json.dumps(payload))
                if found:
                    data = base64.b64decode(found.group(1))
                    if len(data) >= _MIN_IMAGE_BYTES:
                        return data
                    last = f"图只有 {len(data)} 字节(下限 {_MIN_IMAGE_BYTES})"
                else:
                    last = "响应里没有 data URI"
                logger.warning("文生图第 %d/%d 次没拿到有效图:%s", attempt, _IMAGE_TRIES, last)
        raise RuntimeError(f"文生图 {_IMAGE_TRIES} 次均未取得有效图:{last}")
