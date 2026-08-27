"""Agnes Video 2.5 的 OpenAI Videos 兼容协议面。"""

from __future__ import annotations

import json
import re
from urllib.parse import urlencode, urlparse

import httpx

from windup_common.enums.model import ModelErrorType
from windup_framework.gateway.types import AdapterResult

from .openai_video import http_error, json_object
from .types import HttpCall, VideoRequest

AGNES_VIDEO_25 = "agnes-video-2.5"
AGNES_VIDEO_25_FLASH = "agnes-video-2.5-flash"
AGNES_VIDEO_MODELS = frozenset({AGNES_VIDEO_25, AGNES_VIDEO_25_FLASH})
AGNES_OUTPUT_SIZE = "720P"
_RATIO_BY_REDUCED = {
    (7, 3): "21:9",  # 文档给出的 720P 像素是 1680x720，约分后为 7:3。
    (16, 9): "16:9",
    (4, 3): "4:3",
    (1, 1): "1:1",
    (3, 4): "3:4",
    (9, 16): "9:16",
}


def agnes_aspect_ratio(size: str) -> str:
    """内部 ``WIDTHxHEIGHT`` 画布转 Agnes 白名单比例；不支持的比例在建单前拒绝。"""
    matched = re.fullmatch(r"(\d+)x(\d+)", size.strip())
    if matched is None:
        raise ValueError(f"视频画布必须是 WIDTHxHEIGHT，收到 {size!r}")
    width, height = (int(part) for part in matched.groups())
    if width <= 0 or height <= 0:
        raise ValueError(f"视频画布宽高必须为正数，收到 {size!r}")
    import math

    divisor = math.gcd(width, height)
    reduced = (width // divisor, height // divisor)
    ratio = _RATIO_BY_REDUCED.get(reduced)
    if ratio is None:
        allowed = ", ".join(sorted(_RATIO_BY_REDUCED.values()))
        raise ValueError(
            f"Agnes Video 2.5 不支持画幅 {reduced[0]}:{reduced[1]}；可用值：{allowed}"
        )
    return ratio


def _public_url(value: str | None) -> str:
    parsed = urlparse(value or "")
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise ValueError("Agnes 首帧必须是可公开访问的 http(s) 公网 URL")
    return value or ""


def _error_text(value: object) -> str:
    if isinstance(value, dict):
        message = value.get("message")
        if message:
            return str(message)
        return json.dumps(value, ensure_ascii=False, sort_keys=True)
    return str(value or "")


class AgnesVideoProtocol:
    """首帧 URL 建单，随后用 ``video_id + model_name`` 轮询结果。"""

    def __init__(
        self,
        api_key: str,
        base_url: str = "https://apihub.agnes-ai.com/v1",
        *,
        model: str = AGNES_VIDEO_25,
    ) -> None:
        if model not in AGNES_VIDEO_MODELS:
            raise ValueError(f"Agnes 视频型号无效：{model!r}")
        self._key = api_key
        self._model = model
        parsed = urlparse(base_url)
        if parsed.scheme not in {"http", "https"} or not parsed.netloc:
            raise ValueError(f"Agnes Base URL 无效：{base_url!r}")
        self._poll_root = f"{parsed.scheme}://{parsed.netloc}"

    @property
    def _headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self._key}"}

    def build_submit(self, req: VideoRequest) -> HttpCall:
        if req.model != self._model:
            raise ValueError(
                f"Agnes 协议当前绑定模型 {self._model}，收到 {req.model!r}"
            )
        if not 4 <= req.seconds <= 12:
            raise ValueError(f"Agnes 视频时长必须在 4 到 12 秒之间，收到 {req.seconds}")
        body = {
            "model": self._model,
            "prompt": req.prompt,
            "seconds": str(req.seconds),
            "mode": "keyframe",
            "size": AGNES_OUTPUT_SIZE,
            "aspect_ratio": agnes_aspect_ratio(req.size),
            "first_frame": _public_url(req.first_frame_url),
            "n": 1,
        }
        return HttpCall(method="POST", path="/videos", headers=self._headers, body=body)

    def parse_submit(self, resp: httpx.Response) -> AdapterResult:
        if not 200 <= resp.status_code < 300:
            return http_error(resp)
        payload = json_object(resp)
        if payload is None:
            return AdapterResult(
                ok=False,
                error_type=ModelErrorType.INVALID_RESPONSE,
                http_status=resp.status_code,
                edge_fingerprint="响应不是 JSON 对象",
            )
        video_id = payload.get("video_id")
        if not video_id:
            return AdapterResult(
                ok=False,
                error_type=ModelErrorType.INVALID_RESPONSE,
                http_status=resp.status_code,
                edge_fingerprint="响应没有 video_id",
            )
        return AdapterResult(
            ok=True,
            job_id=str(video_id),
            maybe_billed=True,
            http_status=resp.status_code,
            job_status=str(payload.get("status") or "queued").lower(),
        )

    def build_poll(self, job_id: str) -> HttpCall:
        query = urlencode({"video_id": job_id, "model_name": self._model})
        return HttpCall(
            method="GET",
            path=f"{self._poll_root}/agnesapi?{query}",
            headers=self._headers,
        )

    def parse_poll(self, resp: httpx.Response, job_id: str) -> AdapterResult:
        if not 200 <= resp.status_code < 300:
            return http_error(resp, job_id=job_id, phase="follow")
        payload = json_object(resp)
        if payload is None:
            return AdapterResult(
                ok=False,
                error_type=ModelErrorType.INVALID_RESPONSE,
                http_status=resp.status_code,
                job_id=job_id,
                maybe_billed=True,
                edge_fingerprint="轮询响应不是 JSON 对象",
            )
        status = str(payload.get("status") or "").lower()
        if status == "completed":
            metadata = payload.get("metadata")
            url = metadata.get("url") if isinstance(metadata, dict) else None
            if not url:
                # 线上偶尔先把状态推进到 completed，随后才回填 metadata.url。
                # 官方交付条件要求两者同时存在，因此这里继续轮询同一任务；若立即
                # 判 INVALID_RESPONSE，已经生成成功的任务将无法恢复且兜底会重复建单。
                return AdapterResult(
                    ok=False,
                    job_id=job_id,
                    maybe_billed=True,
                    http_status=resp.status_code,
                    job_status="in_progress",
                )
            return AdapterResult(
                ok=True,
                job_id=job_id,
                maybe_billed=True,
                http_status=resp.status_code,
                job_status=status,
                result_url=str(url),
            )
        if status in {"failed", "cancelled"}:
            return AdapterResult(
                ok=False,
                error_type=ModelErrorType.UPSTREAM_FAILED,
                job_id=job_id,
                maybe_billed=True,
                http_status=resp.status_code,
                job_status=status,
                edge_fingerprint=_error_text(payload.get("error")),
            )
        return AdapterResult(
            ok=False,
            job_id=job_id,
            maybe_billed=True,
            http_status=resp.status_code,
            job_status=status or "in_progress",
        )

    def build_fetch(self, job_id: str) -> HttpCall | None:
        del job_id
        return None

    def parse_fetch(self, resp: httpx.Response, job_id: str) -> AdapterResult:
        return self.parse_poll(resp, job_id)
