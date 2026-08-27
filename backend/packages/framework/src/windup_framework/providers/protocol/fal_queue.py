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


# ── veo3.1 ──────────────────────────────────────────────────────────────────

#: veo3.1 的建单端点。型号名(链上/账本里用的 ``veo3.1``)与端点路径分开:前者是
#: 我们的标识,后者是上游的 API 事实,拼不出来也不能互相推。
VEO_ENDPOINT = "fal-ai/veo3.1/image-to-video"

#: 时长档。**带 ``s`` 后缀的字符串**,与 kling 的 ``"5"``(无后缀)形状不同;
#: 混用不会被立刻拒,而是走成另一个计费档。
VEO_DURATIONS = ("4s", "6s", "8s")

#: 上游默认 ``8s``,是最贵的一档。这里不取默认,取最便宜的一档做地板。
VEO_CHEAPEST_DURATION = "4s"

#: 只有横竖两档,**不吃 1:1**。首帧画布是方的时候必须有人做决定,不能让它落到上游去猜。
VEO_ASPECT_RATIOS = ("16:9", "9:16")

VEO_RESOLUTIONS = ("720p", "1080p", "4k")


class VeoSpendGuardError(ValueError):
    """请求体没把烧钱的那几项显式写死。

    单列一个错误类型是为了让它在测试与日志里认得出来:这三项漏掉的代价不是报错,
    是**静默走贵档**——上游默认 ``duration=8s`` + ``generate_audio=true``,
    合起来是 4s 无声那档的 4 倍价,而任务照常成功、没有任何一道会红。
    """


def veo_duration(seconds: int) -> str:
    """秒数 → 允许的时长档,**向下取**。

    向下不向上:向上取是我们替用户多花钱。上游只认这三档,而调用方给的 ``seconds``
    是通用参数(当前链上恒为 5),落不到档位上时取比它小的那一档而不是拒绝——
    拒绝会让"换个视频型号"变成一次要改调用方的改动。
    """
    allowed = sorted(VEO_DURATIONS, key=lambda d: int(d.rstrip("s")))
    fits = [d for d in allowed if int(d.rstrip("s")) <= seconds]
    return fits[-1] if fits else VEO_CHEAPEST_DURATION


def veo_aspect_ratio(size: str) -> str:
    """首帧画布尺寸 → 画幅枚举。

    跟着首帧走而不是写死:``fit_first_frame`` 已经把首帧补边成了 ``size``,画幅与它
    不一致的话上游要么裁掉角色、要么再补一次边,而这两种都得等成片出来才看得见。
    正方形画布在这里就炸——veo 没有 1:1,让它去猜等于用一次已计费的生成来试错。
    """
    w, h = (int(x) for x in size.split("x"))
    if w == h:
        raise VeoSpendGuardError(
            f"veo 画幅只有 {VEO_ASPECT_RATIOS},没有 1:1;首帧画布 {size} 是方的,"
            "请把首帧尺寸改成横或竖"
        )
    return "9:16" if h > w else "16:9"


class VeoQueueVideoProtocol(FalQueueVideoProtocol):
    """veo3.1 专用面:比通用 FAL 面多**四个必填项**,少一条 base64 退路。

    单独一个类而不是给通用面加参数:这四项只对 veo 成立(kling 系连 ``resolution``
    字段都没有),写进通用面就得每家一个分支,而分支写错的代价是一次已计费的错档。
    """

    def __init__(self, api_key: str, *, base_url: str) -> None:
        super().__init__(api_key, VEO_ENDPOINT, base_url=base_url)

    def build_submit(self, req: VideoRequest) -> HttpCall:
        """首帧只走公网 URL;三个烧钱项在这里显式落地并当场自检。"""
        url = (req.first_frame_url or "").strip()
        if not url.startswith(("http://", "https://")):
            raise VeoSpendGuardError(
                f"veo 首帧必须是公网 URL,收到 {url[:32]!r};"
                "base64 会在建单后到生成阶段才 failed,而费用可能已经产生"
            )
        body: dict[str, object] = {
            "prompt": req.prompt,
            FAL_I2V_ENDPOINTS[VEO_ENDPOINT]: url,
            "duration": veo_duration(req.seconds),
            # 有声 $0.40/秒、无声 $0.20/秒,而本仓的产物是序列帧,音轨最后会被丢掉。
            # 付了钱买一条没人听的音轨,是这里唯一会发生的事。
            "generate_audio": False,
            "aspect_ratio": veo_aspect_ratio(req.size),
            "resolution": "720p",
        }
        _assert_spend_pinned(body)
        return HttpCall(
            method="POST",
            path=f"{self._root}/queue/{VEO_ENDPOINT}",
            headers=self._headers,
            body=body,
        )


def _assert_spend_pinned(body: dict[str, object]) -> None:
    """发出去之前再数一遍这四项。

    上面刚写完为什么还要查:这四项的共同点是**漏了不会报错**,上游拿默认值照样出片。
    一次重构把某一行删掉,没有任何一条既有测试会红——除了这里。
    """
    duration = body.get("duration")
    if duration not in VEO_DURATIONS:
        raise VeoSpendGuardError(
            f"duration 必须显式取 {VEO_DURATIONS} 之一(上游默认 8s 是最贵档),收到 {duration!r}"
        )
    if body.get("generate_audio") is not False:
        raise VeoSpendGuardError(
            "generate_audio 必须显式关掉(上游默认 true,走 $0.40/秒 那档,是无声的 2 倍),"
            f"收到 {body.get('generate_audio')!r}"
        )
    if body.get("aspect_ratio") not in VEO_ASPECT_RATIOS:
        raise VeoSpendGuardError(
            f"aspect_ratio 必须是 {VEO_ASPECT_RATIOS} 之一,收到 {body.get('aspect_ratio')!r}"
        )
    if body.get("resolution") not in VEO_RESOLUTIONS:
        raise VeoSpendGuardError(
            f"resolution 必须是 {VEO_RESOLUTIONS} 之一,收到 {body.get('resolution')!r}"
        )
