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

# 只有 kling-video-o1 走 image_list;v2 系列 / sora 走 input_reference(字段按模型选,塞错任务会 failed)。
_IMAGE_LIST_MODELS = ("kling-video-o1",)
DEFAULT_VIDEO_MODEL = "kling-v2-5-turbo"


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
                    raise RuntimeError(f"i2v 失败: {status}")
            if not url:
                raise RuntimeError("i2v 未取得视频 URL(超时或失败)")
            return _download(client, url)


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
    """图像 provider:gemini 系图生图(OpenAI 兼容 ``/chat/completions``,返回 base64 图)。

    参考图 + 文字约束 → 生成一张图(角色基准图 CHARACTER_IMAGE / 逐帧图生图)。
    key / base_url 由 ``AIProviderSettings`` 注入,provider 内不读 env。
    """

    def __init__(
        self,
        config: AIProviderSettings = settings,
        model: str = "gemini-2.5-flash-image",
    ) -> None:
        self._cfg = config
        self._model = model

    def gen_image(self, prompt: str, refs: list[bytes]) -> bytes:
        import json
        import re

        content: list = [{"type": "text", "text": prompt}]
        for r in refs:
            b64 = base64.b64encode(r).decode()
            content.append(
                {"type": "image_url", "image_url": {"url": "data:image/png;base64," + b64}}
            )
        body = {"model": self._model, "messages": [{"role": "user", "content": content}]}
        with httpx.Client(
            base_url=self._cfg.normalized_base_url,
            headers={"Authorization": f"Bearer {self._cfg.api_key}"},
            timeout=self._cfg.timeout,
        ) as client:
            res = client.post(self._cfg.chat_completions_path, json=body).raise_for_status().json()
        m = re.search(r"data:image/[^;]+;base64,([A-Za-z0-9+/=]{100,})", json.dumps(res))
        if not m:
            raise RuntimeError(f"图像响应无有效图: {json.dumps(res)[:200]}")
        return base64.b64decode(m.group(1))
