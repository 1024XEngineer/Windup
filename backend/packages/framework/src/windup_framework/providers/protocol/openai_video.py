"""OpenAI 风格 ``/v1/videos`` 面。

首帧走 base64 dataURI,产物地址在轮询响应的 ``task_result.videos[0].url`` 里,
所以 ``build_fetch`` 恒为 ``None``。
"""
from __future__ import annotations

import base64
import io

import httpx

from windup_common.enums.model import ModelErrorType
from windup_framework.gateway.billing import billing_flags
from windup_framework.gateway.classify import (
    classify_http_response,
    edge_fingerprint,
    retry_after_seconds,
)
from windup_framework.gateway.types import AdapterResult

from .types import HttpCall, VideoRequest

#: 只有 kling-video-o1 走 image_list;v2 系列 / sora 走 input_reference。
#: 字段按模型选,塞错任务会 failed,而费用可能已产生。
IMAGE_LIST_MODELS = ("kling-video-o1",)

#: 透明首帧合成到不透明视频输入时的底色。中灰而不是黑:抠图靠主体与底色的距离判前景,
#: 黑底会把角色的暗部判成背景(#497 的方向已实测为"被抠掉的是最暗部"),白底对浅色角色同理。
FIRST_FRAME_BG = (128, 128, 128)


def fit_first_frame(
    frame: bytes, size: str, *, background: tuple[int, int, int] = FIRST_FRAME_BG
) -> bytes:
    """首帧 bytes → 等比缩放(可放大) + 补边到目标尺寸 → JPG(RGB,q90) bytes。

    不强拉到目标尺寸(母版多为横幅,强压成方会把角色压成瘦长鬼影);JPG 因 PNG base64
    会 VENDOR_FAILED(实测)。

    这一步同时是 kling 系"输出画幅"的唯一控制点:kling 的 i2v 端点没有 resolution/size
    字段,成片画幅跟随首帧,所以 ``size`` 只能在这里生效。

    小于目标画布的输入必须**放大**:128x128 的 sprite 原尺寸贴进 1280x720 只占 13% 高,
    等于自愿把主体有效分辨率砍掉七分之六,之后无论 i2v 还是重抠图都补不回来。

    **放大用 NEAREST,缩小用 LANCZOS。** 放大是把一个源像素铺成一块,插值会在块边界
    造出源图里没有的中间色:实测一张 256x256 的像素画母版放到 720x720,唯一色从 5982
    涨到 32479(5.4 倍),硬边糊成渐变,而这张糊图正是喂给 i2v 的输入。缩小反过来,
    NEAREST 会丢样出锯齿。交付侧的 ``_fit_to`` 早就是这条规则,这里与它对齐。
    """
    from PIL import Image

    w, h = (int(x) for x in size.split("x"))
    im = Image.open(io.BytesIO(frame))
    if im.mode in ("RGBA", "LA") or (im.mode == "P" and "transparency" in im.info):
        im = im.convert("RGBA")
        flat = Image.new("RGB", im.size, background)
        flat.paste(im, (0, 0), im)     # 不能 convert("RGB"):透明像素的 RGB 未定义
        im, pad = flat, background
    else:
        im = im.convert("RGB")
        pad = im.getpixel((0, 0))     # 不透明输入沿用角点色,补边与画面自身背景连成一片
    scale = min(w/im.width, h/im.height)
    if scale > 1:
        # **放大倍数必须取整。** NEAREST 是把一个源像素铺成一块,倍数非整数时那"一块"的
        # 宽度会在相邻整数之间不规则跳变(×2.8125 → 2px/3px 交替),块边长为 1 的像素母版
        # 每个像素都是独立信息,硬边因此被打成马赛克 —— 而这张图正是喂给 i2v 的输入。
        # 选 NEAREST 本就是为了不造出源图没有的中间色,取整是这条意图的另一半(#797)。
        # 实测:256x256 母版进 1280x720,倍数被横屏的 720 卡在 2.8125。
        scale = float(int(scale))
    tw, th = max(1, round(im.width*scale)), max(1, round(im.height*scale))
    fitted = im.resize((tw, th), Image.NEAREST if scale > 1 else Image.LANCZOS)
    canvas = Image.new("RGB", (w, h), pad)
    canvas.paste(fitted, ((w - tw)//2, (h - th)//2))
    buf = io.BytesIO()
    canvas.save(buf, "JPEG", quality=90)
    return buf.getvalue()


def first_frame_datauri(frame: bytes, size: str) -> str:
    """首帧 → base64 dataURI。FAL 队列面同样吃这个形状,故两面共用。"""
    return "data:image/jpeg;base64," + base64.b64encode(fit_first_frame(frame, size)).decode()


def http_error(
    resp: httpx.Response, *, job_id: str | None = None, phase: str = "submit"
) -> AdapterResult:
    """非 2xx 的响应收成 AdapterResult。

    已建单之后的失败一律记 maybe_billed:单据存在就可能已计费,除非请求根本没到上游。
    """
    error_type = classify_http_response(resp.status_code, resp.text, phase=phase)
    retry_after_header = resp.headers.get("Retry-After")
    retry_after_s = retry_after_seconds(retry_after_header) if retry_after_header else None
    maybe_billed = billing_flags(error_type=error_type, http_status=resp.status_code)
    if job_id is not None and error_type not in {
        ModelErrorType.UNREACHED,
        ModelErrorType.NETWORK,
    }:
        maybe_billed = True
    return AdapterResult(
        ok=False,
        error_type=error_type,
        http_status=resp.status_code,
        maybe_billed=maybe_billed,
        edge_fingerprint=edge_fingerprint(resp),
        retry_after_s=retry_after_s,
        job_id=job_id,
    )


def json_object(resp: httpx.Response) -> dict | None:
    """2xx 响应里的 JSON 对象;不是对象就返回 ``None``。

    只挡解码失败不够:上游在 2xx 下返回合法的数组 / 字符串 / ``null`` 时,
    直接 ``.get()`` 会抛 ``AttributeError``,请求以未处理异常结束,
    而不是被收成 ``INVALID_RESPONSE`` 交给 Gateway 判。
    """
    try:
        payload = resp.json()
    except ValueError:
        return None
    return payload if isinstance(payload, dict) else None


class OpenAIVideoProtocol:
    """鉴权头由本层产出而不由厂商层统一注入 —— 写错时的响应与"模型不存在"难以区分。"""

    def __init__(self, api_key: str) -> None:
        self._key = api_key

    @property
    def _headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self._key}"}

    def build_submit(self, req: VideoRequest) -> HttpCall:
        body: dict[str, object] = {
            "model": req.model,
            "prompt": req.prompt,
            "size": req.size,
            "seconds": str(req.seconds),
            "mode": req.mode,
        }
        datauri = first_frame_datauri(req.first_frame, req.size)
        if req.model in IMAGE_LIST_MODELS:
            body["image_list"] = [{"image": datauri.split(",", 1)[1]}]
        else:
            body["input_reference"] = datauri
        return HttpCall(method="POST", path="/videos", headers=self._headers, body=body)

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
        jid = payload.get("id")
        if not jid:
            return AdapterResult(
                ok=False,
                error_type=ModelErrorType.INVALID_RESPONSE,
                http_status=resp.status_code,
                edge_fingerprint="响应没有 job id",
            )
        return AdapterResult(
            ok=True,
            job_id=str(jid),
            body=b"",
            maybe_billed=True,
            http_status=resp.status_code,
        )

    def build_poll(self, job_id: str) -> HttpCall:
        return HttpCall(method="GET", path=f"/videos/{job_id}", headers=self._headers)

    def parse_poll(self, resp: httpx.Response, job_id: str) -> AdapterResult:
        """未完成时 ``error_type`` 为 ``None`` 且 ``ok`` 为假 —— adapter 据此继续轮询。"""
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
        if status == "completed":
            vids = (st.get("task_result") or {}).get("videos") or []
            return AdapterResult(
                ok=True,
                job_id=job_id,
                maybe_billed=True,
                job_status=status,
                result_url=vids[0].get("url") if vids else None,
            )
        if status in ("failed", "cancelled"):
            return AdapterResult(
                ok=False,
                error_type=ModelErrorType.UPSTREAM_FAILED,
                job_id=job_id,
                maybe_billed=True,
                job_status=status,
                edge_fingerprint=str(st.get("error") or ""),
            )
        return AdapterResult(ok=False, job_id=job_id, maybe_billed=True, job_status=status)

    def build_fetch(self, job_id: str) -> HttpCall | None:
        return None

    def parse_fetch(self, resp: httpx.Response, job_id: str) -> AdapterResult:
        """本面的取结果地址就是轮询地址,所以两步解析是同一个。"""
        return self.parse_poll(resp, job_id)
