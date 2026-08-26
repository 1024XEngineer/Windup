"""两条非 chat 面的生图通路。

同一件事(提示词 [+ 参考图] → 一张图 bytes)在网关上有三种形状,型号决定走哪条:
chat 面把图塞 ``messages[].content``、OpenAI 图像面直接回 ``data[].b64_json``、
FAL 队列面要建单-轮询-取结果三段。形状写在代码里而不是配置里 —— 塞错字段不会立刻
报错,任务照常 queued,直到生成阶段才 failed,而费用可能已经产生。
"""
from __future__ import annotations

import base64
import binascii
import io
import json
from dataclasses import replace

import httpx

from windup_common.enums.model import ModelErrorType
from windup_framework.gateway.classify import (
    classify_exception,
    classify_http_response,
    edge_fingerprint,
    retry_after_seconds,
)
from windup_framework.gateway.types import AdapterResult

from .fal_queue import IN_FLIGHT, gateway_root, queue_prefix
from .openai_video import json_object

__all__ = ["OpenAIImagesFace", "FalQueueImageFace", "MIN_IMAGE_BYTES", "IMAGE_SIZE"]

#: 小于这个字节数的"图"当没拿到。0 字节的成功会被原样上传对象存储,变成用户看到的裂图。
MIN_IMAGE_BYTES = 5000

#: 出图尺寸。母版下游还要按项目精灵尺寸等比 contain,这里只需给一个可预期的方图。
IMAGE_SIZE = "1024x1024"

#: FAL 队列面的建单端点。文生图与图生图是两条路径,不能靠拼字符串猜 ——
#: 猜中一条"存在但语义不同"的路径会正常出图、正常计费。
FAL_IMAGE_ENDPOINTS: dict[str, tuple[str, str]] = {
    "gemini-3.1-flash-image-preview": (
        "fal-ai/gemini-3.1-flash-image-preview",
        "fal-ai/gemini-3.1-flash-image-preview/edit",
    ),
}


class UnknownFalImageModelError(ValueError):
    """型号不在 :data:`FAL_IMAGE_ENDPOINTS` 里。"""


def _transport(exc: BaseException) -> AdapterResult:
    error_type, status, edge = classify_exception(exc)
    return AdapterResult(
        ok=False,
        error_type=error_type,
        http_status=status,
        maybe_billed=error_type is ModelErrorType.MAYBE_BILLED,
        edge_fingerprint=edge,
    )


def _http_failure(resp: httpx.Response, model: str, base_url: str) -> AdapterResult:
    error_type = classify_http_response(resp.status_code, resp.text)
    if resp.status_code in (400, 404):
        edge = (
            f"网关 {base_url} 拒绝了模型 {model!r}(HTTP {resp.status_code})。"
            f"生图型号不出现在 GET /models 里,可用性只能靠真实调用确认。"
            f"原始响应:{resp.text[:200]}"
        )
    else:
        edge = edge_fingerprint(resp)
    header = resp.headers.get("Retry-After")
    return AdapterResult(
        ok=False,
        error_type=error_type,
        http_status=resp.status_code,
        maybe_billed=error_type is ModelErrorType.MAYBE_BILLED,
        edge_fingerprint=edge,
        retry_after_s=retry_after_seconds(header) if header else None,
    )


def _billed(exc: BaseException, job_id: str) -> AdapterResult:
    """建单之后的失败:必须带上 job_id 并标 MAYBE_BILLED。

    到这一步 FAL 已经收下任务、可能在计费。通用 ``_transport`` 会把典型读断线分成
    ``UNREACHED`` 且 ``maybe_billed=False``,而 Gateway 对第一次 UNREACHED 是 RETRY_SAME
    —— 于是轮询/取结果/下载任一步的瞬时断线都会重新 POST 建第二个任务,而第一个还在跑、
    照样收钱。标 MAYBE_BILLED 才能让 Gateway 走不重发的那条分支。
    """
    error_type, status, edge = classify_exception(exc)
    return AdapterResult(
        ok=False,
        error_type=ModelErrorType.MAYBE_BILLED,
        http_status=status,
        maybe_billed=True,
        job_id=job_id,
        edge_fingerprint=f"建单后失败(job={job_id}),不重新建单:{edge}",
    )


def _invalid(resp: httpx.Response, why: str) -> AdapterResult:
    return AdapterResult(
        ok=False,
        error_type=ModelErrorType.INVALID_RESPONSE,
        http_status=resp.status_code,
        edge_fingerprint=why,
    )


def _sized(data: bytes, resp: httpx.Response) -> AdapterResult:
    if len(data) < MIN_IMAGE_BYTES:
        return _invalid(resp, f"图只有 {len(data)} 字节(下限 {MIN_IMAGE_BYTES})")
    return AdapterResult(ok=True, body=data, http_status=resp.status_code)


def _datauri(raw: bytes) -> str:
    return "data:image/png;base64," + base64.b64encode(raw).decode()


def _fetch_result(client: httpx.Client, url: str) -> httpx.Response:
    """取成品图。跨源目标要摘掉 client 级凭证。

    ``headers={}`` 不够:httpx 把它与 client 默认头**合并**而不是替换,``Authorization``
    照样发出去。而这个 URL 来自网关响应,正常指向 CDN、异常可以是任意地址 —— 等于把
    API key 交给那个域名。同源时必须保留:网关也会签发自家域名下的下载链接。
    判定复用 ``sufy._download_request``,不在这里造第二份同源逻辑。
    """
    from ..sufy import _download_request

    return client.send(_download_request(client, url))


class OpenAIImagesFace:
    """``/v1/images/generations`` 与 ``/v1/images/edits``,Bearer,同步回图。"""

    def __init__(self, base_url: str, api_key: str, timeout: float) -> None:
        self._base = base_url.rstrip("/")
        self._key = api_key
        self._timeout = timeout

    def _client(self) -> httpx.Client:
        return httpx.Client(
            base_url=self._base,
            headers={"Authorization": f"Bearer {self._key}"},
            timeout=self._timeout,
            transport=httpx.HTTPTransport(retries=2),
        )

    def submit_image(self, prompt: str, refs: list[bytes], model: str) -> AdapterResult:
        with self._client() as client:
            try:
                resp = (
                    self._edit(client, prompt, refs, model)
                    if refs
                    else self._generate(client, prompt, model)
                )
            except httpx.TransportError as exc:
                return _transport(exc)
            if not 200 <= resp.status_code < 300:
                return _http_failure(resp, model, self._base)
            return self._parse(client, resp)

    def _generate(self, client: httpx.Client, prompt: str, model: str) -> httpx.Response:
        return client.post(
            "/images/generations",
            json={"model": model, "prompt": prompt, "size": IMAGE_SIZE, "n": 1},
        )

    def _edit(
        self, client: httpx.Client, prompt: str, refs: list[bytes], model: str
    ) -> httpx.Response:
        """图生图走 multipart,参考图作为文件字段 —— 这条路径尚未用真实调用验证过。"""
        files = [("image[]", (f"ref{i}.png", io.BytesIO(r), "image/png"))
                 for i, r in enumerate(refs)]
        return client.post(
            "/images/edits",
            data={"model": model, "prompt": prompt, "size": IMAGE_SIZE, "n": "1"},
            files=files,
        )

    def _parse(self, client: httpx.Client, resp: httpx.Response) -> AdapterResult:
        payload = json_object(resp)
        if payload is None:
            return _invalid(resp, "响应不是 JSON 对象")
        items = payload.get("data")
        if not isinstance(items, list) or not items:
            return _invalid(resp, "响应里没有 data[]")
        item = items[0]
        # 元素不是对象也可能出现在 2xx 里(如 ``data: [1]``)。直接 .get() 会抛
        # AttributeError,请求以未处理异常结束,而不是被收成 INVALID_RESPONSE 交给
        # Gateway 判 —— 而此时费用已经产生。
        if not isinstance(item, dict):
            return _invalid(resp, f"data[0] 不是对象:{type(item).__name__}")
        if item.get("b64_json"):
            try:
                raw = base64.b64decode(item["b64_json"], validate=True)
            except (binascii.Error, ValueError):
                return _invalid(resp, "b64_json 不是合法的 base64")
            return _sized(raw, resp)
        url = item.get("url")
        if not url:
            return _invalid(resp, "data[0] 既无 b64_json 也无 url")
        try:
            got = _fetch_result(client, url)
        except httpx.TransportError as exc:
            return _transport(exc)
        if not 200 <= got.status_code < 300:
            return _invalid(resp, f"取图失败 HTTP {got.status_code}")
        return _sized(got.content, resp)


class FalQueueImageFace:
    """``/queue/*`` 生图,``Authorization: Key``,建单-轮询-取结果三段。

    与视频的队列面共用前缀与在途状态判定,但产物字段不同(``images[]`` 而非 ``video``),
    所以不复用 :class:`FalQueueVideoProtocol`。
    """

    def __init__(self, base_url: str, api_key: str, timeout: float, *, poll_s: float = 5.0,
                 max_polls: int = 120) -> None:
        self._root = gateway_root(base_url)
        self._key = api_key
        self._timeout = timeout
        self._poll_s = poll_s
        self._max_polls = max_polls

    def _client(self) -> httpx.Client:
        return httpx.Client(
            base_url=self._root,
            headers={"Authorization": f"Key {self._key}"},
            timeout=self._timeout,
            transport=httpx.HTTPTransport(retries=2),
        )

    def submit_image(self, prompt: str, refs: list[bytes], model: str) -> AdapterResult:
        try:
            gen_ep, edit_ep = FAL_IMAGE_ENDPOINTS[model]
        except KeyError:
            raise UnknownFalImageModelError(model) from None
        endpoint = edit_ep if refs else gen_ep
        body: dict = {"prompt": prompt, "num_images": 1}
        if refs:
            # 参考图以 data URI 进 image_urls —— 这条路径尚未用真实调用验证过。
            body["image_urls"] = [_datauri(r) for r in refs]
        with self._client() as client:
            try:
                resp = client.post(f"/queue/{endpoint}", json=body)
            except httpx.TransportError as exc:
                return _transport(exc)
            if not 200 <= resp.status_code < 300:
                return _http_failure(resp, model, self._root)
            body_json = json_object(resp)
            if body_json is None:
                return _invalid(resp, "建单响应不是 JSON 对象")
            job_id = body_json.get("request_id")
            if not job_id:
                return _invalid(resp, "建单响应里没有 request_id")
            return self._follow(client, queue_prefix(endpoint), job_id, resp)

    def _follow(
        self, client: httpx.Client, prefix: str, job_id: str, submitted: httpx.Response
    ) -> AdapterResult:
        root = f"/queue/{prefix}/requests/{job_id}"
        import time

        for _ in range(self._max_polls):
            try:
                st = client.get(f"{root}/status")
            except httpx.TransportError as exc:
                return _billed(exc, job_id)
            if not 200 <= st.status_code < 300:
                return replace(_http_failure(st, prefix, self._root), job_id=job_id)
            poll_json = json_object(st)
            if poll_json is None:
                return replace(_invalid(st, "轮询响应不是 JSON 对象"), job_id=job_id)
            status = poll_json.get("status")
            if status not in IN_FLIGHT:
                break
            time.sleep(self._poll_s)
        else:
            return AdapterResult(
                ok=False,
                error_type=ModelErrorType.TIMEOUT,
                maybe_billed=True,
                job_id=job_id,
                edge_fingerprint=f"轮询 {self._max_polls} 次仍在途",
            )
        try:
            res = client.get(root)
        except httpx.TransportError as exc:
            return _billed(exc, job_id)
        if not 200 <= res.status_code < 300:
            return replace(_http_failure(res, prefix, self._root), job_id=job_id)
        result_json = json_object(res)
        if result_json is None:
            return replace(_invalid(res, "取结果响应不是 JSON 对象"), job_id=job_id)
        images = result_json.get("images")
        first = images[0] if isinstance(images, list) and images else None
        url = first.get("url") if isinstance(first, dict) else None
        if not url:
            return replace(
                _invalid(res, f"结果里没有图片 URL:{json.dumps(result_json)[:200]}"), job_id=job_id
            )
        try:
            got = _fetch_result(client, url)
        except httpx.TransportError as exc:
            return _billed(exc, job_id)
        if not 200 <= got.status_code < 300:
            return replace(_invalid(res, f"下载成品失败 HTTP {got.status_code}"), job_id=job_id)
        return _sized(got.content, submitted)
