"""Provider 接口的 SUFY / qnaigc(Modelink 网关)同步实现。

本模块实现三个 provider:视频(i2v)、图像(文生图 / 图生图)、以及它们共用的下载与首帧
处理。抠图另在 :mod:`.matte`。

视频走 OpenAI 风格面(:class:`SufyVideoProvider`),首帧是 base64 dataURI::

    POST /v1/videos {model, prompt, size, seconds, mode, input_reference}
    轮询 GET /v1/videos/{id} → status==completed → task_result.videos[0].url → 下载 mp4

2026-07-27 对 kling-v2-5-turbo 端到端实测到 completed。

图像走 OpenAI 兼容的 ``/chat/completions``(:class:`SufyImageProvider`),参考图以 data URI
塞进 ``content`` 数组 —— 与视频的提交-轮询-下载三段式完全不同的调用形状。

**网关上还有另一套 FAL 队列面**(veo / seedance / vidu 只在那一面)。曾实现过,但因为
从未被真实调用过而移除,见本文件中段那条注释里记下的两个实测事实。

型号与 key / base_url 均由 ``AIProviderSettings`` 注入,provider 内不读 env;哪个模型吃
什么请求字段属该模型的 API 事实,写在代码里而不是配置里(填错只会在生成阶段才 failed,
而费用可能已产生)。重依赖(PIL)惰性导入,保证模块导入零成本。
"""
from __future__ import annotations

import base64
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
import io
import json
import logging
import math
import re
import time

import httpx

from windup_framework.config.provider import AIProviderSettings, settings

from .interfaces import ImageProvider, VideoProvider

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
        model: str | None = None,
        mode: str = "std",
        poll_interval: float = 60.0,
        max_min: int = 30,
    ) -> None:
        # 轮询间隔必须 > 0:下面用 `max_min * 60 // poll` 算预算次数,传 0 直接除零
        # (2026-08-11 补 i2v 主流程测试时逮到)。0 的语义本身也不成立 —— 那是忙等,
        # 会把网关打满。测试要跑快就把 time.sleep 打桩掉,别把间隔设成 0。
        if poll_interval <= 0:
            raise ValueError(f"poll_interval 必须为正数,收到 {poll_interval}")
        self._cfg = config
        self._model = model or config.video_model
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


# ── FAL 队列面（veo / seedance / vidu）已移除 ────────────────────────────────
#
# 曾有一整套 FalQueueVideoProvider + FirstFrameUploader + 端点映射表（412 行、28 条
# 测试）。删掉的理由与 GenRoute 只列有实现的路线是同一条：**它从未被真实调用过**
# —— app / ai_engine 里零引用，产品链路走不到，而"代码在仓里"会让人以为该能力已具备。
#
# 真要接 veo / seedance 时连同一次真实调用一起加回。届时的两个已知事实（实测挣得，
# 别再摸索一遍）：
#   1. FAL 面只吃**公网 URL**，不吃 base64；塞 base64 会 status=queued 之后在生成阶段
#      才 failed，费用可能已经产生。
#   2. 鉴权头是 `Authorization: Key <k>`，不是 `Bearer`；路径与 /v1 平级，不是它的子路径。
# 归档实测记录见项目参考资料（图生视频 API 实测文档）。


DEFAULT_IMAGE_MODEL = "gemini-2.5-flash-image"

# "调用成功但没返回有效图"的重试次数。与 _download 的网络重试是两码事:那个治连接断,
# 这个治模型返回了一条不含图的正常响应(实测偶发)。也是为什么下面要判 base64 长度 ——
# 返回里可能带一个几十字节的占位串,当图存下去就是一个打不开的文件。
_IMAGE_TRIES = 3
_MIN_IMAGE_BYTES = 5000
_CONNECT_RETRIES = 3
_MAX_RETRY_WAIT = 30.0
_IMAGE_TIMEOUT_MULTIPLIER = 1.5

# 429 是被限流拒收、必然没计费,所以按次数放开重试。它与 _IMAGE_TRIES 会叠乘,单次
# gen_image 的最坏情况因此是:_IMAGE_TRIES × _POST_TRIES = 9 次请求,退避最多睡
# 6 × _MAX_RETRY_WAIT = 180 秒,加上每次请求自身 timeout × _IMAGE_TIMEOUT_MULTIPLIER。
_POST_TRIES = 3

# 521 源站拒绝连接、523 源站不可达都止步于 TCP 层;522 按 Cloudflare 自己的定义含两种
# 情形 —— 握手没收到 SYN+ACK,以及连接已建立但源站未及时确认请求,后者请求已经写到源站。
# 所以"重发不会重复计费"是大概率而非保证,重发次数因此要受 _UNREACHED_RESENDS 约束。
#
# 判据只看码、不看响应头:``AI_BASE_URL`` 后面挂的是哪家网关不可知,靠 ``cf-ray`` +
# ``server: cloudflare`` 认 Cloudflare 会把真实链路上的 52x 全判否(实测网关自报
# ``server: APISIX``),整条重试等于不存在。
#
# 520 与 524 不在此列:连接已建立、请求可能正在源站处理中(524 就是"源站 100 秒没答完"),
# 重发一次就是为同一张图付两次钱。
_CLOUDFLARE_UNREACHED_STATUS = frozenset({521, 522, 523})

# 一次 gen_image 内允许把 52x 重发几次。只按码判就无法排除"网关转发给上游之后才回 52x",
# 与其赌它不存在,不如把最坏情况封成一个小常数:最多多付两张图,且不随上面两层循环叠乘。
_UNREACHED_RESENDS = 2

_DIAGNOSTIC_HEADERS = ("server", "cf-ray", "via", "x-served-by", "retry-after")


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


def _edge_fingerprint(response: httpx.Response) -> str:
    """52x 出自链路上哪一跳,只能从这几个头看 —— 不记下来,线上就只剩一个状态码可复盘。"""
    seen = {k: response.headers.get(k) for k in _DIAGNOSTIC_HEADERS}
    return " ".join(f"{k}={v}" for k, v in seen.items() if v) or "无可辨识的边缘响应头"


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _retry_after_seconds(value: str) -> float | None:
    try:
        delay = float(value)
    except ValueError:
        try:
            retry_at = parsedate_to_datetime(value)
        except (TypeError, ValueError, OverflowError):
            return None
        if retry_at.tzinfo is None:
            retry_at = retry_at.replace(tzinfo=timezone.utc)
        delay = (retry_at.astimezone(timezone.utc) - _utc_now()).total_seconds()
    if not math.isfinite(delay):
        return None
    return min(max(delay, 0.0), _MAX_RETRY_WAIT)


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


class ChatCompletionsFace:
    """网关 ``/chat/completions`` 面的共用管道:建 client、发请求、判哪些失败可以重发。

    出图与判官共用一份 —— 同一网关同一把 key,限流与 52x 的语义一样;各写一份的话,
    改一次重试判据要记得改两处,漏掉的那处的代价是重复计费。
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
            edge = _edge_fingerprint(resp)
            if code in _CLOUDFLARE_UNREACHED_STATUS and not resends.take():
                raise RuntimeError(_retry_exhausted_message(code, resends.spent, edge))
            retryable = code == 429 or code in _CLOUDFLARE_UNREACHED_STATUS
            if not retryable:
                # 5xx 一律留指纹:要不要人工重发,取决于失败落在链路的哪一跳。
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
                # 上限同样兜住指数退避:上游挂掉时不该把一个图像任务堵成长时间阻塞。
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
        # 预算建在循环外:同一张图的多次尝试共用一份"可能已计费"的额度。
        resends = _ResendBudget()
        with self._client() as client:
            for attempt in range(1, _IMAGE_TRIES + 1):
                payload = self._post(client, body, resends)
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
