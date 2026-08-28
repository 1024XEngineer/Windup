"""三个 Protocol 里两个**按次计费**那两个的腾讯云混元实现(+ 一个 COS uploader)。

    TencentModel3DProvider   SubmitHunyuanTo3DProJob / QueryHunyuanTo3DProJob
    TencentAutoRigProvider   SubmitAutoRiggingJob    / DescribeAutoRiggingJob
    TencentCosModelUploader  ModelUploader —— 模型 bytes → COS 预签名 URL

同域名同版本(``ai3d.tencentcloudapi.com`` · ``2025-05-13``),都是异步提交 + 轮询。

**计费(每角色一次性)**:建模按生成模式取积分(Normal 20 / LowPoly 25 / Geometry 15 /
Sketch 25;PBR、多视图各 +10),绑骨固定 10 积分,后付费 0.12 元/积分。套预设动作与本地
渲帧 **0 元**。积分不足报 ``ResourceInsufficient`` —— 那是充值问题,不是接口坏了,
本模块把它翻成 :class:`InsufficientCreditsError` 单独一类,免得又照着文档排查半天。

**花钱要有人点头**:两个 provider 都有 ``allow_spend`` 构造开关,默认 ``False``。
默认档下调用会抛 :class:`SpendNotAuthorizedError`,并把这一次的报价写进异常文本 ——
提交路径因此不可能被"顺手跑一下"触发。开关放在构造而不是方法参数上,是为了让
Protocol 的方法签名保持干净(调用点不需要知道这条链路要花钱)。
"""
from __future__ import annotations

import base64
import hashlib
import logging
import time
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Mapping

from ._tc3 import TencentApiError, TencentCredentials, call, cos_request, cos_sign, redact
from .checks import check_model, sniff_format
from .interfaces import (
    MODEL_FORMATS,
    ArtifactFormatError,
    InsufficientCreditsError,
    JobFailedError,
    JobTimeoutError,
    ModelNotPublicError,
    ModelUploader,
    PresetMotion,
    RiggedModel,
)

__all__ = [
    "TencentModel3DProvider", "TencentAutoRigProvider", "TencentCosModelUploader",
    "SpendNotAuthorizedError", "CREDITS", "PRESET_MOTIONS",
    "RIG_CREDITS", "MAX_IMAGE_BYTES", "VIEW_TYPES",
]

logger = logging.getLogger(__name__)

SERVICE = "ai3d"
VERSION = "2025-05-13"

CREDITS = {"Normal": 20, "LowPoly": 25, "Geometry": 15, "Sketch": 25}
RIG_CREDITS = 10
MAX_IMAGE_BYTES = 6 * 10**6      # ImageBase64 上限
VIEW_TYPES = ("back", "left", "right")   # 正面走主参数,不在这里

# 轮询中允许继续等的状态。**认不出的状态一律当失败**并把 JobId 写进异常 ——
# 一直 continue 会转到超时,把"协议变了"伪装成"生成太慢";而带着 JobId 抛出去,
# 调用方随时能再查一次(任务在云上还在跑,不会因为我们抛错就没了)。
_RUNNING = {"WAIT", "RUN", "RUNNING", "INIT", "PROCESSING", "QUEUING"}

PRESET_MOTIONS: Mapping[str, PresetMotion] = {
    # 只登记横版会用到、且**实测过编号**的那些。1–48 全集见接口文档;没实测过的不编名字,
    # 免得一个猜出来的名字被当成事实用下去。要用别的直接传 1–48 的整数。
    "idle": PresetMotion("idle", 26),
    "idle_2": PresetMotion("idle_2", 27),
    "walk": PresetMotion("walk", 23),
    "walk_2": PresetMotion("walk_2", 24),
    "jog": PresetMotion("jog", 32),
    "run": PresetMotion("run", 34),
    "jump": PresetMotion("jump", 38),
    "jump_forward": PresetMotion("jump_forward", 40),
    "kick": PresetMotion("kick", 18),
    "thrust": PresetMotion("thrust", 16),
}
MOTION_TYPE_RANGE = range(1, 49)

_MAGIC = {"GLB": b"glTF", "FBX": b"Kaydara FBX Binary"}


def _submit_with_backoff(submit, *, attempts: int = 5, base: float = 20.0):
    """撞上游并发上限时退避重试。**只重试 UpstreamBusyError** —— 别的错重试等于重复扣费。

    绑骨接口同时只允许 1 个任务,而且上一个 DONE 之后位子也不立刻释放(实测约 30 秒)。
    不重试的话,两个用户同时建资产,第二个直接失败 —— 而他的图生 3D 已经付过钱了。

    提交本身不计费(计费在上游受理之后),所以重试不会重复扣钱;真正危险的是**成功之后**
    再重试,那由 submit 只被调一次成功路径保证。
    """
    import time

    last = None
    for i in range(attempts):
        try:
            return submit()
        except UpstreamBusyError as exc:
            last = exc
            if i + 1 >= attempts:
                break
            wait = base * (i + 1)
            logger.info("上游绑骨并发已满,%ds 后重试(%d/%d)", int(wait), i + 1, attempts)
            time.sleep(wait)
    raise RuntimeError(
        f"上游同时只能跑一个绑骨任务,等了 {attempts} 轮仍然排不上。稍后再试。"
        f"(最后一次:{last})"
    ) from last


class UpstreamBusyError(RuntimeError):
    """上游并发/频率上限,**可重试**。与"参数错""余额不足"分开。

    绑骨接口同时只允许 1 个任务(实测),撞上时报 ``RequestLimitExceeded.JobNumExceed``。
    把它和别的错混在一个类型里,调用方就只能一律当永久失败 —— 而它退避几十秒就能过。
    """

    def __init__(self, code: str, message: str) -> None:
        super().__init__(f"{code}: {message}")
        self.code = code


class SpendNotAuthorizedError(RuntimeError):
    """provider 构造时没有 ``allow_spend=True``,拒绝提交计费任务。异常文本里带报价。"""


# ── 共用的小工具 ────────────────────────────────────────────────────────────


def _raise_for_error(response: Mapping) -> Mapping:
    """把 ``Response.Error`` 翻成分得开的异常。"""
    err = response.get("Error")
    if not err:
        return response
    code = str(err.get("Code", ""))
    msg = str(err.get("Message", err))
    if "ResourceInsufficient" in code:
        raise InsufficientCreditsError(
            f"积分不足({code}: {msg})。这是充值问题,不是接口坏了 —— "
            "别照着接口文档排查参数。")
    # 上游自己的瞬时故障。**都可重试** —— 2026-08-28 一次端到端里三种都撞到过,
    # 而每一次都是「同一个请求原样再发一遍就过」:
    #
    #   FailedOperation.ServerError      算法服务异常     重试即过
    #   FailedOperation.RequestTimeout   后端服务超时     重试即过
    #   FailedOperation.DownloadError    文件下载失败     ← 这个最误导
    #
    # DownloadError 字面看像"我们的 URL 取不到",实测不是:同一个 18MB URL 在报了
    # DownloadError 之后原样重发就成功了(JobId=1484843892775575552),而那个 URL
    # 我们自己 HEAD 过 —— 206、18366000 字节、content-type 正确。
    # 它照字面排查会把人引到"是不是对象存储坏了",而真因在上游那一侧。
    #
    # 不重试的代价:这三种都发生在**图生 3D 已经付过 20 积分之后**,用户卡在
    # 「模型建好了但绑不了骨」,钱花了、资产建不成。
    if any(x in code for x in ("ServerError", "RequestTimeout", "DownloadError")):
        raise UpstreamBusyError(code or "FailedOperation", msg)
    if "JobNumExceed" in code or "RequestLimitExceeded" in code:
        # 上游**同时只允许 1 个绑骨任务**,而且上一个已经 DONE 位子也不立刻释放
        # (实测 2026-08-28:连续三次被拒,等约 30 秒后即过)—— 所以限的是时间窗,
        # 不是"在跑的任务数"。单列一个类型,让调用方能退避重试而不是当场把错抛给用户。
        #
        # 这一条尤其不能当成永久失败:它发生在图生 3D 已经付过钱之后、绑骨提交之前,
        # 用户会卡在"模型建好了但绑不了骨"的中间态,而钱已经花了。
        raise UpstreamBusyError(code or "RequestLimitExceeded", msg)
    raise TencentApiError(code or "UnknownError", msg)


def _check_image_size(data: bytes, which: str) -> None:
    if len(data) > MAX_IMAGE_BYTES:
        raise ValueError(
            f"{which} 图 {len(data) / 10**6:.1f}MB,超过 ImageBase64 上限 "
            f"{MAX_IMAGE_BYTES / 10**6:.0f}MB")


def _pick_artifact(files: list, want: str, *, strict: bool = True,
                   job_id: str = "") -> tuple[Mapping, str]:
    """按格式挑产物,返回 ``(产物, 它真实的格式)``。**绝不退回 files[0]**。

    ``strict=True``:只认 ``want``。给返回裸 bytes 的调用方用 —— 那边没有字段能说明
    真实格式,拿到 FBX 当 GLB 用会让下游报 Bad glTF,症状伪装成"出帧管线坏了"。

    ``strict=False``:拿不到首选就退到另一个可用格式,真实格式随返回值带出去。给
    ``RiggedModel`` 那种能如实标注 fmt 的调用方用 —— 那里硬要求只会让已经扣过费的
    产物取不回来,而两种格式下游都吃。
    """
    def _fmt(f) -> str:
        return str(f.get("Type", "")).upper() if isinstance(f, Mapping) else ""

    order = (want,) if strict else (want, *(f for f in MODEL_FORMATS if f != want))
    for fmt in order:
        hit = [f for f in files if _fmt(f) == fmt]
        if hit:
            return hit[0], fmt
    got = [_fmt(f) or "?" for f in files]
    raise ArtifactFormatError(
        f"接口没有返回{'' if strict else '任何可用'}{want if strict else '格式'}产物,"
        f"这次返回的是 {got}(可选 {MODEL_FORMATS})。"
        + (f" JobId={job_id} —— 费用已产生,用它重取,别重新提交。" if job_id else ""))


def _verify_magic(data: bytes, want: str) -> None:
    """落地前用 magic bytes 复核。``Type`` 是供应商的自述,magic 才是事实。"""
    magic = _MAGIC[want]
    if data[:len(magic)] != magic:
        raise ArtifactFormatError(
            f"产物自称 {want},但头 {len(magic)} 字节是 {data[:len(magic)]!r},"
            f"不是 {magic!r} —— 别把它当 {want} 存下去。")


def _download(url: str, timeout: int = 600, tries: int = 3) -> bytes:
    """下载已生成好的产物,带重试 + 长度校验。

    重试是安全的:这是对成品 URL 的 GET,幂等且**不再扣积分** —— 重试的代价是一次重下,
    不重试的代价是一次重新生成(积分已经花了)。
    长度校验是因为截断不一定抛异常:服务端提前关流时可能直接返回短 bytes,
    坏模型会一路流到出帧环节才暴露,在那儿看起来像"绑骨坏了"。
    异常文本一律过 :func:`redact` —— 这些 URL 可能带签名。
    """
    # 产物 URL 来自接口响应,不是我们拼的。限定 https 是因为 urllib 会照单全收
    # file:// 与内网地址,并且默认跟随跳转 —— 上游若被污染,这里会把任意本地文件
    # 或元数据端点的内容当作"模型 bytes"返回,而下游只做 magic 校验。
    if urllib.parse.urlparse(url).scheme != "https":
        raise ValueError(f"产物 URL 协议不是 https,拒绝下载:{redact(url)}")
    last: Exception | None = None
    for attempt in range(tries):
        try:
            with urllib.request.urlopen(url, timeout=timeout) as r:
                body = r.read()
                expected = r.headers.get("Content-Length")
                if expected and len(body) != int(expected):
                    raise OSError(f"下载不完整: {len(body)}/{expected} 字节")
                return body
        except Exception as exc:                       # noqa: BLE001 —— 网络层什么都可能
            last = exc
            if attempt < tries - 1:
                time.sleep(2**attempt)
    raise JobFailedError(redact(f"产物下载失败(已重试 {tries} 次): {last}")) from last


# ── uploader ────────────────────────────────────────────────────────────────


class TencentCosModelUploader(ModelUploader):
    """模型 bytes → COS 预签名 URL(私有桶 + 限时读)。

    key 用 **内容哈希**:同一份模型重传不会在桶里堆副本,重试也天然幂等。
    桶名 ``windup-rig-<AppId>``;AppId 由 ``cam:GetUserAppId`` 运行时取一次,不写死。

    ``expire`` 默认 2 小时:URL 必须在**整个绑骨任务周期内**可取(排队 + 绑骨),
    实测单次 40–60 秒,但排队时间不受我们控制,留足余量。
    """

    _EXT = {"model/gltf-binary": "glb", "application/octet-stream": "bin",
            "application/x-fbx": "fbx"}

    def __init__(self, creds: TencentCredentials | None = None, *,
                 bucket_prefix: str = "windup-rig", expire: int = 7200) -> None:
        self._creds = creds or TencentCredentials.resolve()
        self._prefix = bucket_prefix
        self._expire = expire
        self._appid: str | None = None

    def appid(self) -> str:
        if self._appid is None:
            r = _raise_for_error(call("GetUserAppId", {}, service="cam",
                                      version="2019-01-16", creds=self._creds,
                                      idempotent=True))
            if "AppId" not in r:
                raise JobFailedError(redact(f"取 AppId 失败: {r}"))
            self._appid = str(r["AppId"])
        return self._appid

    def bucket(self) -> str:
        return f"{self._prefix}-{self.appid()}"

    def host(self) -> str:
        return f"{self.bucket()}.cos.{self._creds.region}.myqcloud.com"

    def ensure_bucket(self) -> None:
        code, body = cos_request(self._creds, "PUT", "/", self.host())
        if code not in (200, 409):                     # 409 = 已存在且属于你
            raise JobFailedError(redact(f"建桶失败 {code}: {body}"))

    def upload(self, model: bytes, content_type: str) -> str:
        ext = self._EXT.get(content_type, "bin")
        key = f"{hashlib.sha256(model).hexdigest()[:32]}.{ext}"
        host = self.host()
        self.ensure_bucket()
        code, body = cos_request(self._creds, "PUT", f"/{key}", host, data=model)
        if code != 200:
            raise JobFailedError(redact(f"上传失败 {code}: {body}"))
        return f"https://{host}/{key}?{cos_sign(self._creds, 'GET', f'/{key}', host, self._expire)}"


# ── 图生 3D ─────────────────────────────────────────────────────────────────


class TencentModel3DProvider:
    """母版图 bytes → 3D 模型 bytes(混元生 3D 专业版)。

    **输入端要点**:``ImageBase64`` ≤6MB;``Prompt`` 与图片输入互斥(本 provider 只走图);
    背景会被一起建模 —— 送检前把背景压白/透明。
    **输出端要点**:``FaceCount`` 默认 500000,出来的 GLB 常远超绑骨的 60MB 上限。
    本实现默认要 150000 面,少一趟"减面再来"的往返。
    """

    def __init__(
        self,
        creds: TencentCredentials | None = None,
        *,
        generate_type: str = "Normal",
        face_count: int = 150000,
        enable_pbr: bool = False,
        allow_spend: bool = False,
        request_result_format: bool = False,
        poll_interval: float = 20.0,
        max_min: int = 20,
    ) -> None:
        if generate_type not in CREDITS:
            # 构造即校验:未知生成模式在**花钱之前**就炸,和 FalQueueVideoProvider 一个道理。
            raise ValueError(f"未知 GenerateType={generate_type!r},可选 {sorted(CREDITS)}")
        self._creds = creds or TencentCredentials.resolve()
        self._type = generate_type
        self._faces = face_count
        self._pbr = enable_pbr
        self._allow_spend = allow_spend
        self._ask_format = request_result_format
        self._poll = poll_interval
        self._max_min = max_min

    def quote(self, n_views: int = 1) -> int:
        """返回本次要花的积分。PBR、多视图各 +10。纯计算,花钱之前就该问得出花多少。"""
        credits = CREDITS[self._type] + (10 if self._pbr else 0) + (10 if n_views > 1 else 0)
        return credits

    def build_params(self, master: bytes,
                     extra_views: Mapping[str, bytes] | None = None) -> dict:
        """组装请求参数(**不发请求**)。先看一眼再提交,别盲交。

        ``extra_views``:``{"back": bytes, "right": bytes}``,正面走 ``master``。
        多视图重建质量明显优于单图,代价 +10 积分,**硬前提是各视图必须是同一个角色、
        同一姿势、同一尺度** —— 侧/背视要以正面母版做参考图 i2i 出,各自文生等于送了三个人进去。
        """
        # 每张图都要查,不只是 master:超限的侧/背视同样会让整单被拒,而那时钱已经花了。
        _check_image_size(master, "master")
        for view, raw in (extra_views or {}).items():
            _check_image_size(raw, view)
        params: dict = {
            "ImageBase64": base64.b64encode(master).decode(),
            "GenerateType": self._type,
            "FaceCount": self._faces,
        }
        if extra_views:
            bad = sorted(set(extra_views) - set(VIEW_TYPES))
            if bad:
                raise ValueError(f"ViewType 只能取 {VIEW_TYPES},收到 {bad}(正面走主参数)")
            params["MultiViewImages"] = [
                {"ViewType": v, "ViewImageBase64": base64.b64encode(extra_views[v]).decode()}
                for v in extra_views
            ]
        if self._pbr:
            params["EnablePBR"] = True
        return params

    def image_to_3d(self, master: bytes, *, want: str = "GLB",
                    extra_views: Mapping[str, bytes] | None = None) -> bytes:
        if want not in MODEL_FORMATS:
            raise ArtifactFormatError(f"want 只能是 {MODEL_FORMATS},收到 {want!r}")
        params = self.build_params(master, extra_views)
        credits = self.quote(1 + len(extra_views or {}))
        if not self._allow_spend:
            raise SpendNotAuthorizedError(
                f"图生 3D 会消耗 {credits} 积分。"
                "确认要花这笔钱后,用 TencentModel3DProvider(..., allow_spend=True) 构造。")

        if self._ask_format:
            # **默认不发这个参数**。理由:管线里 `result_format` 一直是可选且从未默认用过,
            # 我也没有实测证据说 SubmitHunyuanTo3DProJob 收 ``ResultFormat``;而"想要的格式"
            # 已经由取件端保证(按 Type 挑 + magic 复核,那条路是实测过的)。
            # 发一个没验证过的参数只增加被网关拒的风险,换不到任何保证 —— 所以留成开关,
            # 等谁真的实测过再默认打开。
            params["ResultFormat"] = want
        data, _url = self.image_to_3d_with_url(
            master, want=want, extra_views=extra_views, _params=params
        )
        return data

    def image_to_3d_with_url(
        self, master: bytes, *, want: str = "GLB",
        extra_views: Mapping[str, bytes] | None = None, _params: dict | None = None,
    ) -> tuple[bytes, str]:
        """同 :meth:`image_to_3d`,但**同时给出上游那个产物 URL**。

        为什么要它:绑骨的 ``File3D.Url`` 只要一个取得到的 URL,而上游返回的这个 URL
        本身就是公网可取的(实测有效期 24 小时,``q-key-time`` 是 86398 秒)。把它直接
        交给绑骨,就是**同厂同区的云到云** —— 我们一个字节都不用中转。

        原先每建一个资产要让约 76MB 穿过应用机(下 18 + 上 18 + 下 20 + 上 20),
        而部署机出网上行实测只有 5.5–5.8 MB/s(#713)。

        仍然把 bytes 一并返回:人工确认闸要拿它渲给人看,而那个闸的 URL 必须在整个
        审核期内稳定 —— 上游那个 24 小时会过期(#860)。两个用途、两个 URL,不合并。
        """
        if _params is None:
            if want not in MODEL_FORMATS:
                raise ArtifactFormatError(f"want 只能是 {MODEL_FORMATS},收到 {want!r}")
            _params = self.build_params(master, extra_views)
            if not self._allow_spend:
                raise SpendNotAuthorizedError(
                    f"图生 3D 会消耗 {self.quote(1 + len(extra_views or {}))} 积分。"
                )
            if self._ask_format:
                _params["ResultFormat"] = want
        job = self._submit(_params)
        files = self._wait(job)
        picked, _ = _pick_artifact(files, want, job_id=job)
        url = str(picked["Url"])
        data = _download(url)
        _verify_magic(data, want)
        return data, url

    def _submit(self, params: dict) -> str:
        r = _raise_for_error(call("SubmitHunyuanTo3DProJob", params, service=SERVICE,
                                  version=VERSION, creds=self._creds))
        if "JobId" not in r:
            raise JobFailedError(redact(f"提交图生 3D 没拿到 JobId: {r}"))
        return str(r["JobId"])

    def _wait(self, job_id: str) -> list:
        for _ in range(max(1, int(self._max_min * 60 // self._poll))):
            r = _raise_for_error(call("QueryHunyuanTo3DProJob", {"JobId": job_id},
                                      service=SERVICE, version=VERSION, creds=self._creds,
                                      idempotent=True))
            status = str(r.get("Status") or "")
            if status == "DONE":
                files = r.get("ResultFile3Ds") or r.get("ResultFile3D") or []
                files = files if isinstance(files, list) else [files]
                if not files:
                    raise JobFailedError(f"图生 3D 完成但无产物(JobId={job_id})")
                return files
            if status == "FAIL":
                raise JobFailedError(redact(
                    f"图生 3D 失败(JobId={job_id}): {r.get('ErrorMessage') or r}"))
            if status.upper() not in _RUNNING:
                raise JobFailedError(redact(
                    f"图生 3D 返回未知状态 {status!r}(JobId={job_id}): {r} —— "
                    "任务可能仍在跑,拿这个 JobId 再查一次。"))
            time.sleep(self._poll)
        raise JobTimeoutError(
            f"图生 3D 轮询 {self._max_min} 分钟仍未出结果(JobId={job_id});积分可能已经扣了")


# ── 自动绑骨 ────────────────────────────────────────────────────────────────


class TencentAutoRigProvider:
    """3D 模型 bytes → 绑骨模型 bytes(+ 这次烘进去的预设动作)。

    ``uploader`` **必填且无默认值** —— 接口的 ``File3D.Url`` 只吃公网 URL,构造不出一个
    "没有上传能力的绑骨 provider",免得跑到线上才发现模型送不出去。
    (与 ``FalQueueVideoProvider`` 必须接 ``FirstFrameUploader`` 完全同构。)

    产出骨架(已确立,不必每次重验):**28 骨** · root/Hips/Spine/Neck/Head + 四肢 ·
    **无 ``mixamorig:`` 前缀** · 无手指链 · Spine 单节。挂点按骨名寻址,去前缀后可直接
    复用既有握持参数,无需重标定。
    """

    def __init__(
        self,
        uploader: ModelUploader,
        creds: TencentCredentials | None = None,
        *,
        allow_spend: bool = False,
        precheck: bool = True,
        poll_interval: float = 15.0,
        max_min: int = 10,
    ) -> None:
        self._uploader = uploader
        self._creds = creds or TencentCredentials.resolve()
        self._allow_spend = allow_spend
        self._precheck = precheck
        self._poll = poll_interval
        self._max_min = max_min

    @property
    def preset_motions(self) -> Mapping[str, PresetMotion]:
        return PRESET_MOTIONS

    def quote(self) -> int:
        return RIG_CREDITS

    def resolve_motion(self, motion: str | int | None) -> PresetMotion | None:
        """动作名 / 编号 → :class:`PresetMotion`。名字不认识就抛,不猜编号。"""
        if motion is None:
            return None
        if isinstance(motion, str):
            try:
                return PRESET_MOTIONS[motion]
            except KeyError:
                raise KeyError(
                    f"没登记的动作名 {motion!r};已登记 {sorted(PRESET_MOTIONS)},"
                    f"或直接传 {MOTION_TYPE_RANGE.start}–{MOTION_TYPE_RANGE.stop - 1} 的编号。"
                ) from None
        mt = int(motion)
        if mt not in MOTION_TYPE_RANGE:
            raise ValueError(
                f"MotionType 只能是 {MOTION_TYPE_RANGE.start}–{MOTION_TYPE_RANGE.stop - 1},收到 {mt}")
        known = next((p for p in PRESET_MOTIONS.values() if p.motion_type == mt), None)
        return known or PresetMotion(f"motion_{mt}", mt)

    def rig_from_url(self, model_url: str, src_fmt: str, *, want: str = "GLB",
                     motion: str | int | None = None) -> RiggedModel:
        """绑骨,输入是一个**已经在上游那边**的 URL。**云到云,我们不中转字节。**

        与 :meth:`rig` 的分工:那个吃 bytes(先上传再提交),这个吃 URL(直接提交)。
        上游返回的产物 URL 本身就是公网可取的,交回给同一个上游就是同厂同区的下载 ——
        实测 2026-08-28 提交成功(JobId=1484794020202692608),我们传输 0 字节。

        省掉的是每资产约 36MB 的中转(下 18 + 上 18),而部署机出网上行只有
        5.5–5.8 MB/s(#713)。

        ``src_fmt`` 由调用方给,**不嗅探** —— 嗅探要先把文件拉下来,那正是本方法要省的
        那一跳。给错的代价是上游拒单(不扣费),而不是错产物。
        """
        preset = self.resolve_motion(motion)      # 先把认不出的动作名炸掉
        credits = self.quote()
        if not self._allow_spend:
            raise SpendNotAuthorizedError(
                f"绑骨会消耗 {credits} 积分。"
                "确认要花这笔钱后,用 TencentAutoRigProvider(..., allow_spend=True) 构造。")
        if not model_url.startswith(("http://", "https://")):
            raise ModelNotPublicError(
                f"绑骨服务器要能取到这个 URL,收到 {redact(model_url)[:80]!r}")
        job = _submit_with_backoff(lambda: self._submit(model_url, src_fmt, preset))
        logger.info("绑骨已提交并计费(云到云) JobId=%s —— 后续任何失败都用它重取", job)
        files = self._wait(job)
        picked, got = _pick_artifact(files, want, strict=False, job_id=job)
        data = _download(str(picked["Url"]))
        _verify_magic(data, got)
        return RiggedModel(data=data, fmt=got, motion=preset.name if preset else None)

    def rig(self, model: bytes, *, want: str = "GLB",
            motion: str | int | None = None) -> RiggedModel:
        if want not in MODEL_FORMATS:
            raise ArtifactFormatError(f"want 只能是 {MODEL_FORMATS},收到 {want!r}")
        src_fmt = sniff_format(model)                  # 嗅探,不信调用方声明
        preset = self.resolve_motion(motion)           # 先把认不出的动作名炸掉
        if self._precheck:
            # 入口预检在**上传与提交之前**:三条硬约束违反了接口不报错,只默默出错结果。
            check_model(model)

        credits = self.quote()
        if not self._allow_spend:
            raise SpendNotAuthorizedError(
                f"绑骨会消耗 {credits} 积分。"
                "确认要花这笔钱后,用 TencentAutoRigProvider(..., allow_spend=True) 构造。")

        url = self._upload(model, src_fmt)
        job = _submit_with_backoff(lambda: self._submit(url, src_fmt, preset))
        logger.info("绑骨已提交并计费 JobId=%s —— 后续任何失败都用它重取,别重新提交", job)
        files = self._wait(job)
        picked, got = _pick_artifact(files, want, strict=False, job_id=job)
        data = _download(str(picked["Url"]))
        _verify_magic(data, got)
        return RiggedModel(data=data, fmt=got, motion=preset)

    def fetch(self, job_id: str, *, want: str = "GLB") -> RiggedModel:
        """取一个**已完成**任务的产物。零成本,不重新提交。

        存在的理由:提交之后的任何失败(格式、下载、进程被杀)都不该让已经扣过的费作废。
        """
        picked, got = _pick_artifact(self._wait(job_id), want, strict=False, job_id=job_id)
        data = _download(str(picked["Url"]))
        _verify_magic(data, got)
        return RiggedModel(data=data, fmt=got, motion=None)

    def _upload(self, model: bytes, fmt: str) -> str:
        ct = "model/gltf-binary" if fmt == "GLB" else "application/x-fbx"
        url = self._uploader.upload(model, ct)
        if not isinstance(url, str) or not url.startswith(("http://", "https://")):
            # 本地路径 / dataURI 在这一面必然产不出正确结果 —— 宁可在提交前炸。
            # 注意这里**不回显 url 全文**:预签名 URL 里带 SecretId 与签名。
            raise ModelNotPublicError(
                f"uploader 必须返回 http(s) 公网 URL(绑骨服务器要能取到),"
                f"收到 {redact(str(url))[:80]!r}")
        return url

    def _submit(self, model_url: str, fmt: str, preset: PresetMotion | None) -> str:
        params: dict = {"File3D": {"Url": model_url, "Type": fmt}}
        if preset is not None:
            params["MotionType"] = preset.motion_type
        r = _raise_for_error(call("SubmitAutoRiggingJob", params, service=SERVICE,
                                  version=VERSION, creds=self._creds))
        if "JobId" not in r:
            raise JobFailedError(redact(f"提交绑骨没拿到 JobId: {r}"))
        return str(r["JobId"])

    def _wait(self, job_id: str) -> list:
        for _ in range(max(1, int(self._max_min * 60 // self._poll))):
            r = _raise_for_error(call("DescribeAutoRiggingJob", {"JobId": job_id},
                                      service=SERVICE, version=VERSION, creds=self._creds,
                                      idempotent=True))
            status = str(r.get("Status") or "")
            if status == "DONE":
                files = r.get("ResultFile3Ds") or []
                if not files:
                    raise JobFailedError(f"绑骨完成但无产物(JobId={job_id})")
                return files
            if status == "FAIL":
                raise JobFailedError(redact(f"绑骨失败(JobId={job_id}): {r.get('ErrorMessage') or r}"))
            if status.upper() not in _RUNNING:
                raise JobFailedError(
                    f"绑骨返回未知状态 {status!r}(JobId={job_id}): {r} —— "
                    "任务可能仍在跑,拿这个 JobId 再查一次。")
            time.sleep(self._poll)
        raise JobTimeoutError(
            f"绑骨轮询 {self._max_min} 分钟仍未出结果(JobId={job_id});积分可能已经扣了")
