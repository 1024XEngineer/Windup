"""Provider 接口的 SUFY / qnaigc(OpenAI-compatible)同步实现。

视频走异步任务协议(2026-07-27 端到端实测):
  POST /videos {model, prompt, size, seconds, mode, input_reference}
  轮询 GET /videos/{id} → status==completed → task_result.videos[0].url → 下载 mp4
key / base_url 由 ``AIProviderSettings`` 注入,provider 内不读 env。
重依赖(rembg)惰性导入,保证模块导入零成本。
"""
from __future__ import annotations

import base64
import io
import time

import httpx

from windup_framework.config.provider import AIProviderSettings, settings

from .interfaces import ImageProvider, VideoProvider

# 首帧字段**按模型选**,不是按"本地图/公网 URL"选。厂商文档:Kling 用 image_list,
# Sora 用 input_reference。塞错的后果分两种,后一种更危险:
#   - 老模型(v2 系列):任务 queued 后在生成时 failed "model is not supported"。
#     提交层不报错,必须轮询到 completed 才算验证过。
#   - kling-v3-omni:**任务 completed,但参考图被静默忽略**,退化成纯文生视频。
#     2026-08-07 实测:送一张插画风角色母版 + 侧走提示词,拿回一段写实路人走路的
#     视频,费用照付、无任何异常。整条管线下游(抽帧/选帧/抠图/对齐)对此毫无察觉,
#     产出 16 帧"看起来成功"的错角色成品。
# 故:新增 kling 模型时必须查文档确认字段,并按下面的 _needs_image_list 归类。
_IMAGE_LIST_MODELS = ("kling-video-o1", "kling-v3-omni", "kling-v3")
DEFAULT_VIDEO_MODEL = "kling-v2-5-turbo"


def _needs_image_list(model: str) -> bool:
    """该模型的首帧是否走 ``image_list``(而非 ``input_reference``)。

    显式白名单 + ``kling-v3`` 前缀兜底 —— 厂商文档写明 Kling 系用 image_list,但
    v2-5-turbo / v2-1 已实测可吃 input_reference(2026-07-27 端到端到 completed),
    为不破坏既有通路,仅对已确认的型号切换。
    """
    return model in _IMAGE_LIST_MODELS or model.startswith("kling-v3")


def _first_frame_datauri(frame: bytes, size: str) -> str:
    """首帧 bytes → 等比缩放 + 背景色补边到目标尺寸 → JPG(RGB,q90) base64 dataURI。

    不强拉到目标尺寸(母版多为横幅,强压成方会把角色压成瘦长鬼影);JPG 因 PNG base64
    会 VENDOR_FAILED(实测)。
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
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()


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
        if _needs_image_list(self._model):
            b64 = _first_frame_datauri(first_frame, size).split(",", 1)[1]
            body["image_list"] = [{"image": b64, "type": "first_frame"}]
        else:
            body["input_reference"] = _first_frame_datauri(first_frame, size)

        with self._client() as client:
            job = client.post("/videos", json=body).raise_for_status().json()
            jid = job.get("id")
            _assert_reference_registered(job, self._model)
            url = None
            for _ in range(max(1, int(self._max_min * 60 // self._poll))):
                time.sleep(self._poll)
                st = client.get(f"/videos/{jid}").raise_for_status().json()
                status = st.get("status")
                if status == "completed":
                    _assert_reference_registered(st, self._model)
                    vids = (st.get("task_result") or {}).get("videos") or []
                    url = vids[0].get("url") if vids else None
                    break
                if status in ("failed", "cancelled"):
                    raise RuntimeError(f"i2v 失败: {status} — {st.get('error')}")
            if not url:
                raise RuntimeError("i2v 未取得视频 URL(超时或失败)")
            return _download(client, url)


class ReferenceIgnoredError(RuntimeError):
    """送了首帧,网关却按"无参考视频"计费 —— 参考图被静默丢弃。"""


def _assert_reference_registered(payload: dict, model: str) -> None:
    """确认网关**真的收下了**首帧,而不是当成纯文生视频跑。

    为什么需要这道检查:i2v 塞错首帧字段时,老模型会 failed(还能发现),但
    kling-v3-omni 会**成功返回**一段与母版毫无关系的文生视频 —— 费用照付、
    status=completed、帧数正常,下游抽帧/抠图/对齐全部照常工作,产出一组
    "看起来成功"的错角色成品(2026-08-07 实测,烧掉一单)。

    网关在 ``billing_type_description`` 里明写计费口径,含"无参考视频"即表示
    它按文生视频计费。这是目前唯一能在**下载视频之前**发现该问题的信号,
    比事后对比画面便宜得多。字段缺失时不拦(不同网关字段不一定存在)。
    """
    desc = str(payload.get("billing_type_description") or "")
    if "无参考视频" in desc:
        raise ReferenceIgnoredError(
            f"模型 {model} 按「{desc}」计费 —— 首帧被静默忽略,产出将与母版无关。"
            "首帧字段按模型选:Kling 用 image_list,Sora 用 input_reference。"
        )


class IncompleteDownloadError(RuntimeError):
    """视频下载到的字节数与 ``Content-Length`` 不符。"""


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
    """
    last: Exception | None = None
    for attempt in range(tries):
        try:
            response = client.get(url)
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


class SufyImageProvider(ImageProvider):
    """图像 provider(gemini-flash-image)。逐帧图生图路线(hit/idle)待开发。

    见 #53 / PerFrameStrategy:per-frame 路线不在"视频优先"首个竖线内,此处留真接口、
    未接 HTTP,避免 ship 一个假装能跑的桩。walk 主链不经此 provider。
    """

    def gen_image(self, prompt: str, refs: list[bytes]) -> bytes:
        raise NotImplementedError(
            "逐帧图生图 provider 待开发(见 #53 / PerFrameStrategy);walk 视频主链不用它"
        )
