"""FAL 队列面 ``/queue/*``。

与 OpenAI 面的形状差别只有一处实质性的:成败不在轮询那一步显形。成功与失败的任务在
``/status`` 都是 200 + ``COMPLETED``,只有取结果那一步才分得开,所以本面的
``build_fetch`` 返回真的 ``HttpCall`` 而不是 ``None``。
"""
from __future__ import annotations

from collections.abc import Mapping

import httpx

from windup_common.enums.model import ModelErrorType
from windup_framework.gateway.classify import edge_fingerprint
from windup_framework.gateway.types import AdapterResult

from .openai_video import first_frame_datauri, http_error, json_object
from .types import HttpCall, VideoRequest

#: 端点 → 首帧字段名。同为 kling,o1 叫 ``start_image_url``,别家叫 ``image_url``;
#: 猜不出来也不能按前缀推。塞错字段建单会被 400 拒,而少一个字段的那种拒法
#: (``{msg}_url is required``)与"这个端点不存在"在响应里长得一样。
FAL_I2V_ENDPOINTS: Mapping[str, str] = {
    "fal-ai/kling-video/o1/image-to-video": "start_image_url",
    "bytedance/seedance-2.0/image-to-video": "image_url",
    "fal-ai/veo3.1/image-to-video": "image_url",
    "fal-ai/vidu/q1/image-to-video": "image_url",
}

#: 队列里还在跑。除这两个之外的状态一律当终态处理 —— 认不出的状态继续轮询,会把
#: "协议变了"伪装成"生成太慢",转满预算才报超时。
IN_FLIGHT = ("IN_QUEUE", "IN_PROGRESS")


class UnknownFalEndpointError(ValueError):
    """端点不在 :data:`FAL_I2V_ENDPOINTS` 里。

    不做前缀匹配、不做兜底:猜中一条"存在但语义不同"的路径(把 image-to-video 猜成
    reference-to-video)会正常出片、正常计费。
    """


def gateway_root(base_url: str) -> str:
    """把 OpenAI 兼容面的 base_url 退回网关根。

    ``/queue/...`` 与 ``/v1/...`` 平级,拿 ``.../v1`` 直接拼会得到 ``/v1/queue/...`` → 404。
    """
    root = base_url.rstrip("/")
    return root[: -len("/v1")] if root.endswith("/v1") else root


def queue_prefix(endpoint: str) -> str:
    """建单端点 → 轮询与取结果共用的前缀,取前两段。

    后面几段(``o1`` / ``image-to-video`` / ``pro``)只在建单时有意义,单据地址不带它们
    —— 六个 kling 型号共用同一个前缀。
    """
    return "/".join(endpoint.strip("/").split("/")[:2])


class FalQueueVideoProtocol:
    """一个实例对应一个端点:该面的型号由端点路径表达,请求体里不带 model 字段。"""

    def __init__(self, api_key: str, endpoint: str, *, base_url: str) -> None:
        if endpoint not in FAL_I2V_ENDPOINTS:
            raise UnknownFalEndpointError(
                f"端点 {endpoint!r} 不在 FAL 图生视频端点表里,"
                f"已登记: {sorted(FAL_I2V_ENDPOINTS)}"
            )
        self._key = api_key
        self._endpoint = endpoint
        self._root = gateway_root(base_url)

    @property
    def _headers(self) -> dict[str, str]:
        # 本面是 ``Key`` 而不是 ``Bearer``,写错时的 401 与"模型不存在"难以区分。
        return {"Authorization": f"Key {self._key}"}

    def _requests_url(self, job_id: str) -> str:
        return f"{self._root}/queue/{queue_prefix(self._endpoint)}/requests/{job_id}"

    def build_submit(self, req: VideoRequest) -> HttpCall:
        """首帧走 base64 dataURI。

        ``req.seconds`` 目前落不到请求体上:十个端点的时长字段虽同叫 ``duration``,取值
        形态却分 ``5`` / ``"5"`` / ``"5s"`` 三种且未逐个实测,猜错就是一次已计费的 400。
        """
        body: dict[str, object] = {
            "prompt": req.prompt,
            FAL_I2V_ENDPOINTS[self._endpoint]: first_frame_datauri(
                req.first_frame, req.size
            ),
        }
        # 路径是绝对地址而不是相对路径:客户端的 base_url 指着 OpenAI 面的 ``/v1``,
        # 交给它拼会拼出 ``/v1/queue/...``。
        return HttpCall(
            method="POST",
            path=f"{self._root}/queue/{self._endpoint}",
            headers=self._headers,
            body=body,
        )

    def parse_submit(self, resp: httpx.Response) -> AdapterResult:
        if not (200 <= resp.status_code < 300):
            return http_error(resp)
        payload = json_object(resp)
        if payload is None:
            return AdapterResult(
                ok=False,
                error_type=ModelErrorType.INVALID_RESPONSE,
                http_status=resp.status_code,
                edge_fingerprint="响应不是 JSON 对象",
            )
        jid = payload.get("request_id")
        if not jid:
            return AdapterResult(
                ok=False,
                error_type=ModelErrorType.INVALID_RESPONSE,
                http_status=resp.status_code,
                edge_fingerprint="响应没有 request_id",
            )
        return AdapterResult(
            ok=True,
            job_id=str(jid),
            body=b"",
            maybe_billed=True,
            http_status=resp.status_code,
        )

    def build_poll(self, job_id: str) -> HttpCall:
        return HttpCall(
            method="GET", path=f"{self._requests_url(job_id)}/status", headers=self._headers
        )

    def parse_poll(self, resp: httpx.Response, job_id: str) -> AdapterResult:
        """``ok`` 只表示轮询到此为止,不表示成功 —— 成败要由 :meth:`parse_fetch` 判。"""
        if not (200 <= resp.status_code < 300):
            return http_error(resp, job_id=job_id, phase="follow")
        st = json_object(resp)
        if st is None:
            return AdapterResult(
                ok=False,
                error_type=ModelErrorType.INVALID_RESPONSE,
                http_status=resp.status_code,
                job_id=job_id,
                maybe_billed=True,
                edge_fingerprint="轮询响应不是 JSON 对象",
            )
        status = st.get("status")
        if status == "COMPLETED":
            return AdapterResult(
                ok=True, job_id=job_id, maybe_billed=True, job_status=status
            )
        if status in IN_FLIGHT:
            return AdapterResult(ok=False, job_id=job_id, maybe_billed=True, job_status=status)
        return AdapterResult(
            ok=False,
            error_type=ModelErrorType.UPSTREAM_FAILED,
            job_id=job_id,
            maybe_billed=True,
            job_status=str(status) if status is not None else None,
            edge_fingerprint=str(st.get("detail") or status or ""),
        )

    def build_fetch(self, job_id: str) -> HttpCall | None:
        return HttpCall(method="GET", path=self._requests_url(job_id), headers=self._headers)

    def parse_fetch(self, resp: httpx.Response, job_id: str) -> AdapterResult:
        """取结果那一步才分得开成败。

        400 在这里不一定是"请求错":未就绪时 veo3.1 与 vidu 实测返回 400 + ``IN_PROGRESS``,
        当成客户端错误会把还在跑的任务判死,而单据已建、可能已计费。
        """
        detail = _detail(resp)
        if resp.status_code == 400 and (pending := _in_flight_status(resp)):
            return AdapterResult(
                ok=False, job_id=job_id, maybe_billed=True, job_status=pending
            )
        if resp.status_code >= 500 and detail:
            return AdapterResult(
                ok=False,
                error_type=ModelErrorType.UPSTREAM_FAILED,
                http_status=resp.status_code,
                job_id=job_id,
                maybe_billed=True,
                # 网关自己的失败分类(VENDOR_FAILED / RUNTIME_CREATE_PROVIDER_FAILED)比
                # 一个恒为 COMPLETED 的状态值值钱得多。
                job_status=str(detail.get("type") or "") or None,
                edge_fingerprint=str(detail.get("msg") or "") or edge_fingerprint(resp),
            )
        if not (200 <= resp.status_code < 300):
            return http_error(resp, job_id=job_id, phase="follow")
        url = _video_url(resp)
        if not url:
            return AdapterResult(
                ok=False,
                error_type=ModelErrorType.INVALID_RESPONSE,
                http_status=resp.status_code,
                job_id=job_id,
                maybe_billed=True,
                edge_fingerprint="取结果 2xx 但没有 video.url",
            )
        return AdapterResult(
            ok=True,
            job_id=job_id,
            maybe_billed=True,
            job_status="COMPLETED",
            result_url=url,
        )


def _payload(resp: httpx.Response) -> dict:
    return json_object(resp) or {}


def _detail(resp: httpx.Response) -> dict:
    detail = _payload(resp).get("detail")
    return detail if isinstance(detail, dict) else {}


def _in_flight_status(resp: httpx.Response) -> str | None:
    status = _payload(resp).get("status")
    return status if status in IN_FLIGHT else None


def _video_url(resp: httpx.Response) -> str | None:
    """两处都认:取结果端点给的是顶层 ``video``,``/status`` 内联的那份裹在 ``result`` 里。

    只认一处而对面给的是另一处,丢掉的是一段已经生成、已经付过钱的视频。
    """
    payload = _payload(resp)
    for holder in (payload, payload.get("result")):
        if isinstance(holder, dict):
            video = holder.get("video")
            if isinstance(video, dict) and video.get("url"):
                return str(video["url"])
    return None
