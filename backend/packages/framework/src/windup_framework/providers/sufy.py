"""Provider 接口的 SUFY / qnaigc(Modelink 网关)同步实现。

本模块实现三个 provider:视频(i2v)、图像(文生图 / 图生图)、以及它们共用的下载与首帧
处理。抠图另在 :mod:`.matte`。

视频走 OpenAI 风格面(:class:`SufyVideoProvider`),首帧是 base64 dataURI::

    POST /v1/videos {model, prompt, size, seconds, mode, input_reference}
    轮询 GET /v1/videos/{id} → status==completed → task_result.videos[0].url → 下载 mp4

2026-07-27 对 kling-v2-5-turbo 端到端实测到 completed。

图像走 OpenAI 兼容的 ``/chat/completions``(:class:`SufyImageProvider`),参考图以 data URI
塞进 ``content`` 数组 —— 与视频的提交-轮询-下载三段式完全不同的调用形状。

**网关上还有另一套 FAL 队列面**(veo / seedance / vidu 只在那一面),协议实现在
:mod:`.protocol.fal_queue`;本 provider 经 ``_protocol_for`` 按型号的 family 分派到它,
目前只接了 veo3.1(默认关,见 ``AI_VIDEO_ALLOW_VEO``)。

型号与 key / base_url 均由 ``AIProviderSettings`` 注入,provider 内不读 env;哪个模型吃
什么请求字段属该模型的 API 事实,写在代码里而不是配置里(填错只会在生成阶段才 failed,
而费用可能已产生)。重依赖(PIL)惰性导入,保证模块导入零成本。
"""
from __future__ import annotations

import base64
import json
import logging
import re
import time
from dataclasses import replace

import httpx

from windup_common.enums.model import ModelErrorType
from windup_framework.config.provider import AIProviderSettings, settings
from windup_framework.gateway.classify import (
    classify_exception,
    classify_http_response,
    edge_fingerprint,
    retry_after_seconds as _retry_after_seconds,
)
from windup_framework.gateway.types import AdapterResult

from .interfaces import FirstFrameUploader, ImageProvider, VideoProvider
from .protocol import HttpCall, VideoRequest
from .protocol.fal_queue import VeoQueueVideoProtocol
from .protocol.image_faces import FalQueueImageFace, OpenAIImagesFace
from .protocol.openai_video import OpenAIVideoProtocol, fit_first_frame

logger = logging.getLogger("windup.providers.sufy")

DEFAULT_VIDEO_MODEL = "kling-v2-5-turbo"


def _transport_result(exc: BaseException) -> AdapterResult:
    """POST 还没拿到状态行:收成 AdapterResult,让 Gateway 按 UNREACHED 决定是否重发。"""
    error_type, status, edge = classify_exception(exc)
    return AdapterResult(
        ok=False,
        error_type=error_type,
        http_status=status,
        maybe_billed=error_type is ModelErrorType.MAYBE_BILLED,
        edge_fingerprint=edge,
    )


def _poll_get(client: httpx.Client, call: HttpCall) -> httpx.Response:
    """轮询 GET;522/525(及同档未达上游码)该次再试 1 次,不新开单。"""
    def once() -> httpx.Response:
        return client.request(call.method, call.path, headers=dict(call.headers))

    resp = once()
    if resp.status_code in (521, 522, 523, 525):
        resp = once()
    return resp


class SufyVideoProvider(VideoProvider):
    """kling i2v(默认 v2-5-turbo)。首帧 + 动作 prompt → mp4 bytes。"""

    def __init__(
        self,
        config: AIProviderSettings = settings,
        model: str | None = None,
        mode: str = "std",
        poll_interval: float = 60.0,
        max_min: int = 30,
        first_poll_after: float = 5.0,
        uploader: FirstFrameUploader | None = None,
    ) -> None:
        # 轮询间隔必须 > 0:0 的语义不成立 —— 那是忙等,会把网关打满。
        # 测试要跑快就把 time.sleep 打桩掉,别把间隔设成 0。
        if poll_interval <= 0:
            raise ValueError(f"poll_interval 必须为正数,收到 {poll_interval}")
        if first_poll_after <= 0:
            raise ValueError(f"first_poll_after 必须为正数,收到 {first_poll_after}")
        self._cfg = config
        self._model = model or config.video_model
        self._mode = mode
        self._poll = poll_interval
        self._max_min = max_min
        self._first_poll_after = min(first_poll_after, poll_interval)
        # 可选而不是必填:链上绝大多数型号(kling 系)不需要它,把它设成必填会让
        # "只跑 kling 的部署" 也必须配好对象存储凭证才建得起 provider。
        # 缺它时 veo 在**建单之前**就被拒(见 _first_frame_url),不会先花钱再发现。
        self._uploader = uploader

    def _protocol_for(self, model: str | None):
        """按登记的 family 取协议面 —— 对照出图侧的 ``SufyImageProvider._face``。

        分派点必须吃 model 而不是放构造函数里:网关每一跳都可能换型号,一个 provider
        实例要能同时伺候 kling 与 veo;构造时定死的话,跨面兜底那一跳会用错形状发出去。

        ``model`` 为空时退回 OpenAI 面 —— 那是历史调用点(``poll_i2v`` 没带型号)的形状,
        而 veo 的单据在那条面上取不到,所以建单时一定要把型号传下来。
        """
        from windup_framework.gateway.registry import FAMILIES
        from windup_framework.gateway.types import Family

        if FAMILIES.get(model or "") is Family.VIDEO_FAL_QUEUE:
            # 每次现取:key 由 config 注入,provider 建好之后 config 仍可能被换。
            return VeoQueueVideoProtocol(
                self._cfg.api_key, base_url=self._cfg.normalized_base_url
            )
        return OpenAIVideoProtocol(self._cfg.api_key)

    def _first_frame_url(self, first_frame: bytes, size: str) -> str:
        """首帧 bytes → 公网 URL。传的是 ``fit_first_frame`` 的产物,不是原始母版。

        必须同一份:补边/缩放决定了成片画幅,而 ``aspect_ratio`` 又是按这个 ``size``
        推的;传原图会让"我们声明的画幅"和"上游实际看到的图"对不上。
        """
        if self._uploader is None:
            raise RuntimeError(
                "veo 首帧只吃公网 URL,但本 provider 没有注入 uploader;"
                "组装层要传 FirstFrameUploader 进来"
            )
        return self._uploader.upload(fit_first_frame(first_frame, size), "image/jpeg")

    def _client(self) -> httpx.Client:
        return httpx.Client(
            base_url=self._cfg.normalized_base_url,
            headers={"Authorization": f"Bearer {self._cfg.api_key}"},
            timeout=self._cfg.timeout,
        )

    def submit_video(
        self,
        first_frame: bytes,
        prompt: str,
        seconds: int,
        size: str,
        model: str,
    ) -> AdapterResult:
        """一次 POST 建单。成功: ok=True, job_id, body=b"", maybe_billed=True。"""
        protocol = self._protocol_for(model)
        req = VideoRequest(
            model=model,
            prompt=prompt,
            seconds=seconds,
            size=size,
            mode=self._mode,
            first_frame=first_frame,
        )
        if isinstance(protocol, VeoQueueVideoProtocol):
            # 只有这一面需要先上传、且有一组建单前的硬断言,所以 try 只包住它 ——
            # 包住 kling 那条会顺手改掉一条跑在线上的路径的失败语义,而那不是本次要动的东西。
            # 失败一律记 maybe_billed=False:这一步还没碰上游,和"发出去了但不知道结果"
            # 是两回事,混起来会让账面凭空多出没发生的花费,也会让本可以直接重试的失败
            # 被当成可能已计费而不敢重发。
            try:
                req = replace(req, first_frame_url=self._first_frame_url(first_frame, size))
                call = protocol.build_submit(req)
            except (ValueError, RuntimeError) as exc:
                return AdapterResult(
                    ok=False,
                    error_type=ModelErrorType.UNREACHED,
                    maybe_billed=False,
                    edge_fingerprint=f"建单前被拒: {exc}",
                )
        else:
            call = protocol.build_submit(req)
        with self._client() as client:
            try:
                resp = client.request(
                    call.method, call.path, json=call.body, headers=dict(call.headers)
                )
            except httpx.TransportError as exc:
                return _transport_result(exc)
        return protocol.parse_submit(resp)

    def inspect_job(self, job_id: str, model: str | None = None) -> AdapterResult:
        """单次 GET 任务状态,不 sleep、不下载。

        completed: ``ok=True``,视频 URL 放 ``edge_fingerprint``(Gateway poll 靠这个
        去 ``download_completed``)。进行中: ``ok=False``,``error_type is None``。

        ``model`` 决定用哪个协议面。不传时退回 OpenAI 面 —— 这是 kling 系的老形状,
        veo 的单据在那条路径上是 404,所以异步轮询那条链必须把型号一路带下来。
        """
        protocol = self._protocol_for(model)
        with self._client() as client:
            resp = _poll_get(client, protocol.build_poll(job_id))
            parsed = protocol.parse_poll(resp, job_id)
            if parsed.error_type is not None or not parsed.ok:
                return parsed
            # FAL 队列面的成败不在轮询这一步显形:成功与失败的任务 ``/status`` 都是
            # 200 + COMPLETED,只有取结果那一步才分得开。OpenAI 面的 build_fetch 恒为
            # None,于是这一段对 kling 是空操作。
            fetch = protocol.build_fetch(job_id)
            if fetch is not None:
                parsed = protocol.parse_fetch(_poll_get(client, fetch), job_id)
                if parsed.error_type is not None or not parsed.ok:
                    return parsed
        url = parsed.result_url
        if not url:
            return AdapterResult(
                ok=False,
                error_type=ModelErrorType.INVALID_RESPONSE,
                job_id=job_id,
                maybe_billed=True,
                job_status="completed",
                edge_fingerprint="completed 但没有视频 URL",
            )
        # 状态值统一成小写 ``completed``:两个面的字面量不同(FAL 是 ``COMPLETED``),
        # 而 follow_job 与 VideoGateway.poll_i2v 都按这个字符串判成片就绪 ——
        # 不归一化的话 veo 会一直被当成"还在跑",直到轮询预算耗光才报超时,
        # 而视频其实早就生成好、钱也早就花了。
        return replace(parsed, edge_fingerprint=url, job_status="completed")

    def follow_job(self, job_id: str, model: str | None = None) -> AdapterResult:
        """轮询已建单据 + 下载。poll GET 522/525 该次再试 1 次,不新开单。"""
        poll_t0 = time.monotonic()
        poll_count = 0

        def with_poll(
            result: AdapterResult, *, download_ms: int | None = None
        ) -> AdapterResult:
            return replace(
                result,
                poll_ms=int((time.monotonic() - poll_t0) * 1000),
                poll_count=poll_count,
                download_ms=download_ms,
            )

        url = None
        last_status: str | None = None
        # 先短后长,而不是每次都睡满 ``poll_interval``。此前第一次查询也要等满一个
        # 间隔:60 秒的间隔下,一段 20 秒就绪的视频要到第 60 秒才被发现,纯白等。
        # 退避到上限后与原来一致,所以对慢任务不增加网关压力。
        # 次数与时间双上限。只用时间会让"永不完成"这类用例必须真等满预算
        # (实测把一条 0.01 秒的用例拖成 60 秒);只用次数则退避变快之后预算被提前
        # 耗光。两者取先到的那个。
        budget = max(1, int(self._max_min * 60 // self._poll))
        deadline = time.monotonic() + self._max_min * 60
        wait = self._first_poll_after
        for _ in range(budget):
            if time.monotonic() >= deadline:
                break
            time.sleep(wait)
            wait = min(wait * 2, self._poll)
            snap = self.inspect_job(job_id, model)
            poll_count += 1
            last_status = snap.job_status
            if snap.ok and snap.job_status == "completed":
                url = snap.edge_fingerprint
                break
            if snap.error_type is not None:
                return with_poll(snap)
        poll_ms = int((time.monotonic() - poll_t0) * 1000)
        if not url:
            return replace(
                AdapterResult(
                    ok=False,
                    error_type=ModelErrorType.TIMEOUT,
                    job_id=job_id,
                    maybe_billed=True,
                    job_status=last_status or "timeout",
                ),
                poll_ms=poll_ms,
                poll_count=poll_count,
            )
        downloaded = self.download_completed(job_id, url)
        return with_poll(downloaded, download_ms=downloaded.download_ms)

    def download_completed(self, job_id: str, url: str) -> AdapterResult:
        """按 inspect 拿到的 URL 下载 mp4,不轮询。"""
        try:
            download_t0 = time.monotonic()
            with self._client() as client:
                body = _download(client, url)
            download_ms = int((time.monotonic() - download_t0) * 1000)
        except RuntimeError as exc:
            return AdapterResult(
                ok=False,
                error_type=ModelErrorType.MAYBE_BILLED,
                job_id=job_id,
                maybe_billed=True,
                job_status="completed",
                edge_fingerprint=str(exc),
            )
        return AdapterResult(
            ok=True,
            body=body,
            job_id=job_id,
            maybe_billed=True,
            job_status="completed",
            download_ms=download_ms,
        )

    def i2v(
        self, first_frame: bytes, prompt: str, seconds: int = 5, size: str = "1280x720"
    ) -> bytes:
        submitted = self.submit_video(first_frame, prompt, seconds, size, self._model)
        if not submitted.ok or not submitted.job_id:
            raise RuntimeError(
                f"i2v 建单失败(HTTP {submitted.http_status} {submitted.error_type}): "
                f"{submitted.edge_fingerprint}"
            )
        followed = self.follow_job(submitted.job_id, self._model)
        if followed.ok:
            return followed.body
        if followed.error_type is ModelErrorType.TIMEOUT:
            raise RuntimeError("i2v 未取得视频 URL(超时或失败)")
        if followed.error_type is ModelErrorType.UPSTREAM_FAILED:
            raise RuntimeError(
                f"i2v 失败: {followed.job_status} — {followed.edge_fingerprint}"
            )
        raise RuntimeError(
            f"i2v 失败(HTTP {followed.http_status} {followed.error_type}): "
            f"{followed.edge_fingerprint}"
        )


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
# 首帧字段一律是 URL 形态(image_url / start_image_url)。字段名虽叫 *_url,值可以是
# base64 dataURI —— 2026-08-24 实测三个端点:kling-video/o1 喂纯品红图,产物首帧
# 平均 RGB (255,1,201);vidu/q1 与 veo3.1 喂纯中灰图,产物首帧同为纯中灰。故两面共用
# 同一套首帧编码,不需要 bytes → 公网 URL 的上传器。
# (seedance-2.0 未验:它的输入尺寸下限是 14px,那次探针的图只有 8px 被上游拒。)
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


# ── FAL 队列面:veo3.1 已接回,seedance / vidu 仍未接 ─────────────────────────
#
# 这段原本记的是"整套 FalQueueVideoProvider 已删除,理由是它从未被真实调用过"。
# veo3.1 现已接进 CHARACTER_ACTION 链(藏在 AI_VIDEO_ALLOW_VEO 后面,默认关),
# 那条理由对它不再成立;seedance / vidu 仍然零引用,对它们仍然成立 —— 谁要接谁
# 连同一次真实调用一起加回,别只把代码放进仓里。
#
# 两条实测事实(挣来的,别再摸索一遍):
#   1. 鉴权头是 `Authorization: Key <k>`,不是 `Bearer`;路径与 /v1 平级,不是子路径。
#   2. 首帧形态:本文件里有**两条互相矛盾**的实测记录,接的时候按"只吃公网 URL"实现。
#      - 上面那段(2026-08-25,#569)说字段值可以是 base64 dataURI,并给了 veo3.1 喂
#        纯中灰图、产物首帧同为纯中灰的证据;
#      - 这段(2026-08-11 起)说 FAL 面只吃公网 URL,塞 base64 会 status=queued 之后
#        在生成阶段才 failed,而费用可能已经产生。
#      没有复测就不裁决,而两条路的代价不对称:URL 在两种说法下都成立,base64 只在
#      其中一种下成立,且它错的那一面要收钱。所以 veo 走 URL,并在建单前就拒掉
#      非 http(s) 的首帧(见 VeoQueueVideoProtocol)。真要省掉这次上传,得先拿一次
#      带账单的复测来推翻其中一条,再回来改这段注释。


DEFAULT_IMAGE_MODEL = "gpt-image-2"

# "调用成功但没返回有效图"的下限。返回里可能带一个几十字节的占位串,当图存下去就是一个打不开的文件。
_MIN_IMAGE_BYTES = 5000
_CONNECT_RETRIES = 3
_MAX_RETRY_WAIT = 30.0
_IMAGE_TIMEOUT_MULTIPLIER = 1.5

# 判官 ``_post`` 自带的 429 / 52x 重试。出图不走这里：Gateway 一次一枪。
_POST_TRIES = 3

# 521 源站拒绝连接、523 源站不可达都止步于 TCP 层;522 按 Cloudflare 自己的定义含两种
# 情形 —— 握手没收到 SYN+ACK,以及连接已建立但源站未及时确认请求,后者请求已经写到源站。
# 所以"重发不会重复计费"是大概率而非保证,重发次数因此要受 _UNREACHED_RESENDS 约束。
_CLOUDFLARE_UNREACHED_STATUS = frozenset({521, 522, 523})
_UNREACHED_RESENDS = 2

class _ResendBudget:
    """跨 _post 的多次调用共享:叠乘的是循环次数,可重复计费的次数不该跟着叠乘。"""

    def __init__(self) -> None:
        self._left = _UNREACHED_RESENDS
        self.spent = 0

    def take(self) -> bool:
        if self._left <= 0:
            return False
        self._left -= 1
        self.spent += 1
        return True


def _retry_exhausted_message(status: int, tries: int, fingerprint: str) -> str:
    """这条文本常常是线上唯一留下的失败记录,少一样就得靠猜是限流、还是哪一跳断的。"""
    if status == 429:
        return (
            f"图像服务请求过于频繁(HTTP {status})，连发 {tries} 次均被限流；"
            f"请稍后重试或检查服务商额度；{fingerprint}"
        )
    return (
        f"图像网关未能连上上游(HTTP {status})，已重发 {tries} 次仍未通；"
        f"再重发有重复计费风险，故停止；{fingerprint}"
    )


# 从响应里捞 data URI。模型把图放在 message.content 里,而不同网关的包裹层级不一样
# (有的 content 是字符串、有的是 parts 数组),故对整个响应 JSON 做一次正则,
# 不去猜层级 —— 猜错的代价是"调用成功、费用已产生、但我们说没图"。
_DATA_URI = re.compile(r"data:image/[^;]+;base64,([A-Za-z0-9+/=]{100,})")


def _image_result_from_2xx(resp: httpx.Response) -> AdapterResult:
    try:
        payload = resp.json()
    except ValueError:
        return AdapterResult(
            ok=False,
            error_type=ModelErrorType.INVALID_RESPONSE,
            http_status=resp.status_code,
            edge_fingerprint="响应不是 JSON",
        )
    found = _DATA_URI.search(json.dumps(payload))
    if not found:
        return AdapterResult(
            ok=False,
            error_type=ModelErrorType.INVALID_RESPONSE,
            http_status=resp.status_code,
            edge_fingerprint="响应里没有 data URI",
        )
    data = base64.b64decode(found.group(1))
    if len(data) < _MIN_IMAGE_BYTES:
        return AdapterResult(
            ok=False,
            error_type=ModelErrorType.INVALID_RESPONSE,
            http_status=resp.status_code,
            edge_fingerprint=f"图只有 {len(data)} 字节(下限 {_MIN_IMAGE_BYTES})",
        )
    return AdapterResult(ok=True, body=data, http_status=resp.status_code)


class ChatCompletionsFace:
    """网关 ``/chat/completions`` 面的共用管道:建 client、发请求。

    判官走 ``_post``(自带 429 / 52x 重试);出图走 ``submit_image`` 一次一枪,
    重试由 Gateway 做。client / 指纹 / 超时倍数仍共用,免得两处配成两套。
    """

    # 出图比一次问答慢得多,所以超时按能力放大;判官用基准超时。
    _timeout_multiplier: float = 1.0

    def __init__(self, config: AIProviderSettings, model: str) -> None:
        self._cfg = config
        self._model = model

    def _client(self) -> httpx.Client:
        return httpx.Client(
            base_url=self._cfg.normalized_base_url,
            headers={"Authorization": f"Bearer {self._cfg.api_key}"},
            timeout=self._cfg.timeout * self._timeout_multiplier,
            # retries 只覆盖建连阶段的失败(SSL 握手、连接被重置)。本机走代理时这类抖动
            # 常见,已跑通的管线实现正是靠一层网络重试扛住的;不加会在人家能恢复的地方
            # 放弃。它不重试读超时与 5xx —— 那两种请求可能已达上游,重发会重复计费。
            transport=httpx.HTTPTransport(retries=_CONNECT_RETRIES),
        )

    def _post(self, client: httpx.Client, body: dict, resends: _ResendBudget) -> dict:
        """发送请求，只重试大概率没被上游收下的失败(429 与 521/522/523)。

        为什么把 400 / 404 单独挑出来说:同一把 key 下不同网关的模型目录**不一样**。实测
        ``GET /v1/models``:一个网关 73 个模型、一个图像模型都没有;另一个 134 个、
        含本模块默认的那个(2026-08-10)。配错 ``AI_BASE_URL`` 时原始报错只是一条
        404,读的人无从知道该去改配置还是改模型名。
        """
        for attempt in range(1, _POST_TRIES + 1):
            resp = client.post(self._cfg.chat_completions_path, json=body)
            code = resp.status_code
            edge = edge_fingerprint(resp)
            if code in _CLOUDFLARE_UNREACHED_STATUS and not resends.take():
                raise RuntimeError(_retry_exhausted_message(code, resends.spent, edge))
            retryable = code == 429 or code in _CLOUDFLARE_UNREACHED_STATUS
            if not retryable:
                if code >= 500:
                    logger.warning(
                        "图像服务返回 %d,不重发(无法排除请求已到达上游并计费);%s",
                        code, edge,
                    )
                break
            if attempt == _POST_TRIES:
                raise RuntimeError(_retry_exhausted_message(code, _POST_TRIES, edge))
            delay = _retry_after_seconds(resp.headers.get("Retry-After", ""))
            if delay is None:
                delay = min(float(2**attempt), _MAX_RETRY_WAIT)
            logger.warning(
                "模型服务返回 %d，第 %d/%d 次请求，%.2f 秒后重试;%s",
                code,
                attempt,
                _POST_TRIES,
                delay,
                edge,
            )
            time.sleep(delay)
        if resp.status_code in (400, 404):
            raise RuntimeError(
                f"网关 {self._cfg.normalized_base_url} 拒绝了模型 {self._model!r}"
                f"(HTTP {resp.status_code})。先确认该网关的目录里有它:"
                f"GET {self._cfg.normalized_base_url}/models —— 不同网关目录不同,"
                f"同一把 key 也是。原始响应:{resp.text[:200]}"
            )
        return resp.raise_for_status().json()

    def submit_image(self, prompt: str, refs: list[bytes], model: str) -> AdapterResult:
        """提示词 + 参考图 → 一次 POST → AdapterResult。重试由 Gateway 做。"""
        content: list[dict] = [{"type": "text", "text": prompt}]
        for raw in refs:
            b64 = base64.b64encode(raw).decode()
            content.append({
                "type": "image_url",
                "image_url": {"url": f"data:image/png;base64,{b64}"},
            })
        body = {"model": model, "messages": [{"role": "user", "content": content}]}
        with self._client() as client:
            try:
                resp = client.post(self._cfg.chat_completions_path, json=body)
            except httpx.TransportError as exc:
                return _transport_result(exc)

        if 200 <= resp.status_code < 300:
            return _image_result_from_2xx(resp)

        error_type = classify_http_response(resp.status_code, resp.text)
        if resp.status_code in (400, 404):
            edge = (
                f"网关 {self._cfg.normalized_base_url} 拒绝了模型 {model!r}"
                f"(HTTP {resp.status_code})。先确认该网关的目录里有它:"
                f"GET {self._cfg.normalized_base_url}/models —— 不同网关目录不同,"
                f"同一把 key 也是。原始响应:{resp.text[:200]}"
            )
        else:
            edge = edge_fingerprint(resp)
        retry_after_header = resp.headers.get("Retry-After")
        retry_after_s = (
            _retry_after_seconds(retry_after_header) if retry_after_header else None
        )
        return AdapterResult(
            ok=False,
            error_type=error_type,
            http_status=resp.status_code,
            maybe_billed=error_type is ModelErrorType.MAYBE_BILLED,
            edge_fingerprint=edge,
            retry_after_s=retry_after_s,
        )


class SufyImageProvider(ChatCompletionsFace, ImageProvider):
    """文生图 / 图生图 provider(OpenAI 兼容的 ``/chat/completions`` 面)。

    调用形状与 i2v 那两个 provider 完全不同:图像走 chat 接口、参考图以 data URI 塞进
    ``content`` 数组,没有提交-轮询-下载三段式。

    2026-08-10 修:此前 ``gen_image`` 直接抛 NotImplementedError,而
    ``POST /generation/image`` 端点是可达的、``ImageTaskExecutor`` 又默认实例化本类 ——
    于是每个图像任务都稳定走到 FAILED。端点看着可用、实际必失败,正是本仓最忌讳的形态
    (机器审逮到)。实现取自管线仓已跑通的通路(同日用它出过三张角色母版)。
    """

    _timeout_multiplier = _IMAGE_TIMEOUT_MULTIPLIER

    def __init__(
        self,
        config: AIProviderSettings = settings,
        model: str | None = None,
    ) -> None:
        super().__init__(config, model or config.image_model)

    def _face(self, model: str):
        """按登记的 family 取协议面;链上主备分属不同面时,靠这里而不是靠换 adapter。

        网关每次把型号名传进 ``submit_image``,所以分派点必须在这里 —— 放到构造函数里
        就变成"一个 provider 只会一种面",跨面兜底那一跳会用错形状发出去。
        """
        from windup_framework.gateway.registry import FAMILIES
        from windup_framework.gateway.types import Family

        family = FAMILIES.get(model, Family.IMAGE_CHAT_DATA_URI)
        timeout = self._cfg.timeout * _IMAGE_TIMEOUT_MULTIPLIER
        if family is Family.IMAGE_OPENAI_IMAGES:
            return OpenAIImagesFace(
                self._cfg.normalized_base_url, self._cfg.api_key, timeout
            )
        if family is Family.IMAGE_FAL_QUEUE:
            return FalQueueImageFace(
                self._cfg.normalized_base_url, self._cfg.api_key, timeout
            )
        return None

    def submit_image(self, prompt: str, refs: list[bytes], model: str) -> AdapterResult:
        face = self._face(model)
        if face is None:
            return super().submit_image(prompt, refs, model)
        return face.submit_image(prompt, refs, model)

    def gen_image(self, prompt: str, refs: list[bytes]) -> bytes:
        """提示词 + 参考图 → 一张 PNG bytes。拿不到有效图就抛,不返回空 bytes。

        为什么不返回空 bytes 兜底:上游 ``ImageTaskExecutor`` 会把返回值直接上传对象存储
        并写进任务结果,一个 0 字节的"成功"会变成用户看到的一张裂图。
        """
        r = self.submit_image(prompt, refs, self._model)
        if r.ok:
            return r.body
        if r.error_type is ModelErrorType.INVALID_RESPONSE:
            raise RuntimeError(f"文生图未取得有效图:{r.edge_fingerprint}")
        raise RuntimeError(
            f"文生图失败(HTTP {r.http_status} {r.error_type}): {r.edge_fingerprint}"
        )
