"""造型级 3D 资产的**面向人的**那一层:母版预检 + 建资产流程的状态与放行。

``render3d_assets.Render3DAssetBuilder`` 只认 bytes、只做"没有就建",它不知道母版在
哪张表的哪个字段上、也没有可以给人点的按钮。本模块补上这两件,并把两段付费调用挪出
请求线程 —— 图生 3D 与绑骨各要几十秒到几分钟,同步跑等于让浏览器挂在那儿等超时。

**分层**:本模块经 builder 牵出 ai_engine,故 web/worker **不得 import 本模块**
(会违反"入口层不经 ai_engine 直连"的门禁,该契约是传递性的)。装配方式与
``executor`` 一样:bootstrap import + 注入 ``app.state``,web 端运行期取回。
出参因此一律是 JSON-ready 的 ``dict`` —— 让 web 层为了标注类型去 import 本模块,
等于把刚才那条门禁绕过去。

━━ 为什么母版这道闸比模型那道更值钱 ━━

一张母版约 ¥0.29,图生 3D 一次 ¥2.40。母版不合格 → 模型必然不合格,而混元的模型
**生成即最终**(拓扑、绑点在生成那一步定死,事后改不动),只能重来。所以同一个错误,
在母版处纠成本是 ¥0.29,在模型处纠是 ¥2.40 + 已花的 ¥0.29。闸要放在最便宜的位置。
"""
from __future__ import annotations

import logging
import os
import pathlib
import threading
from collections.abc import Callable
from dataclasses import dataclass

from windup_ai_engine.master_check import check_master
from windup_ai_engine.ports import MasterRejected

from windup_app.server.orchestrator._fetch import FetchNotAllowed, fetch_own_media
from windup_app.server.orchestrator.render3d_assets import (
    AUTORIG_CREDITS,
    BUILD_CNY,
    BUILD_CREDITS,
    MODEL3D_CREDITS,
    RAW_KEY_PREFIX,
    CharacterAssetStore,
    LocalDirAssetStore,
    LocalDirModelReview,
    ModelAwaitingReview,
    Render3DAssetBuilder,
    Render3DAssetState,
    SpendNotAuthorized,
)

logger = logging.getLogger("windup.render3d.service")

__all__ = [
    "PHASE_BUILDING", "PHASE_FAILED", "PHASE_RIGGING",
    "FetchNotAllowed", "MasterPrecheckFailed", "Render3DAssetOperations",
    "SpendNotAuthorized", "default_operations", "precheck_master",
    "precheck_master_bytes",
]

# 落点里存"绑骨模型的公网 URL"用的键前缀。与模型 bytes 同一个 store,是因为两者的
# 存活期必须一致:模型还在而 URL 丢了,前端会一直显示"没有 3D 模型",而钱已经花完。
_URL_PREFIX = "url:"

# 只存在于内存里的两个过渡态。进程重启会丢 —— 丢了也只是退回按落点推出来的真状态
# (absent / awaiting_review),不会撒谎说"已就绪"。
PHASE_BUILDING = "building"
PHASE_RIGGING = "rigging"
PHASE_FAILED = "failed"


def precheck_master_bytes(master: bytes, canvas: tuple[int, int] | None = None) -> dict:
    """对一张母版跑零成本预检,把结果翻成 JSON。**不抛业务异常,拒绝也是一种结果。**

    拒绝之所以走返回值而不是异常:第一个调用方是母版确认闸上的展示,"这张不能用"
    正是它要显示的东西。真正需要拦住的地方(建资产入口)自己看 ``accepted``,
    见 :meth:`Render3DAssetOperations.build`。
    """
    try:
        facts = check_master(master, canvas)
    except MasterRejected as exc:
        return {"accepted": False, "reject_code": exc.code.value, "detail": exc.detail,
                "facts": None, "warnings": []}
    return {
        "accepted": True,
        "reject_code": None,
        "detail": facts.note(),
        "facts": {
            "width": facts.size[0],
            "height": facts.size[1],
            "subject_ratio": round(facts.subject_ratio, 4),
            "subject_area_ratio": round(facts.subject_area_ratio, 6),
            "limb_segments": list(facts.limb_segments),
            "components": list(facts.components),
        },
        "warnings": [{"code": w.code.value, "detail": w.detail} for w in facts.warnings],
    }


def precheck_master(master_url: str, canvas: tuple[int, int] | None = None) -> dict:
    """:func:`precheck_master_bytes` 的 URL 版。取图受限于自家对象存储,见 ``_fetch``。"""
    return precheck_master_bytes(fetch_own_media(master_url), canvas)


class MasterPrecheckFailed(ValueError):
    """母版没过预检,拒绝为它花钱建 3D。``report`` 原样带给上层做文案。"""

    def __init__(self, report: dict) -> None:
        super().__init__(f"母版未通过预检({report['reject_code']}):{report['detail']}")
        self.report = report


@dataclass
class _Job:
    """一个造型正在进行中的那段付费调用。``error`` 非空即 :data:`PHASE_FAILED`。"""

    phase: str
    error: str | None = None


def _spawn_thread(work: Callable[[], None]) -> None:
    threading.Thread(target=work, daemon=True).start()


class Render3DAssetOperations:
    """建资产流程里**人能触达的四个动作**:看状态、建、放行、否掉。

    ``spawn`` 可注入:缺省起后台线程,测试里换成"就地跑完",这样用例不必等线程收敛
    (等线程的用例会变成偶发失败,而偶发失败最后都会被人当噪音忽略)。
    """

    def __init__(
        self,
        builder: Render3DAssetBuilder,
        store: CharacterAssetStore,
        publish: Callable[[bytes], str],
        *,
        fetch: Callable[[str], bytes] = fetch_own_media,
        spawn: Callable[[Callable[[], None]], None] = _spawn_thread,
    ) -> None:
        self._builder = builder
        self._store = store
        self._publish = publish
        self._fetch = fetch
        self._spawn = spawn
        self._jobs: dict[str, _Job] = {}
        self._lock = threading.Lock()

    # ── 查 ───────────────────────────────────────────────────────────────
    def view(self, outfit_key: str) -> dict:
        """状态 + 成本。**不花钱、无副作用**,可以随便轮询。

        成本恒在返回里,不只在"还没建"的时候给:前端拿它渲染那条"20+10 积分、
        约 ¥3.60"的提示,而按次计费的触发点绝不能出现在用户不知情的时候。
        """
        state = self._builder.state(outfit_key)
        with self._lock:
            job = self._jobs.get(outfit_key)
        phase = state.value
        error = None
        if job is not None and state is not Render3DAssetState.READY:
            phase, error = job.phase, job.error
        rigged_url = self._store.get(f"{_URL_PREFIX}{outfit_key}")
        review_url = self._store.get(f"{_URL_PREFIX}{RAW_KEY_PREFIX}{outfit_key}")
        return {
            "asset_key": outfit_key,
            "state": phase,
            "model_3d_url": rigged_url.decode() if rigged_url else None,
            "review_model_url": review_url.decode() if review_url else None,
            "error": error,
            "cost": {
                "model3d_credits": MODEL3D_CREDITS,
                "autorig_credits": AUTORIG_CREDITS,
                "total_credits": BUILD_CREDITS,
                "total_cny": BUILD_CNY,
                "billing": "postpaid",
                "scope": "per_outfit_once",
            },
        }

    # ── 三个动作 ─────────────────────────────────────────────────────────
    def build(self, outfit_key: str, master_url: str) -> dict:
        """① 图生 3D。**这一步开始花钱**,所以只在两个前提都成立时才起:
        该造型确实还什么都没有,且母版过得了零成本预检。

        预检不过就在这里拒:母版不合格 → 模型必然不合格,而模型改不动只能重生成。
        警告不拦 —— 它们已经在母版确认闸上给人看过,人点了"就用这张"就是他的决定。
        """
        if not self._builder.may_build_assets:
            raise SpendNotAuthorized(
                f"本部署未开启建 3D 资产(需 WINDUP_RENDER3D_ALLOW_SPEND)。建一次 "
                f"{BUILD_CREDITS} 积分,约 ¥{BUILD_CNY}。"
            )
        state = self._builder.state(outfit_key)
        if state is not Render3DAssetState.ABSENT:
            raise ValueError(f"造型 {outfit_key!r} 的 3D 资产已处于 {state.value},不能重复建")
        with self._lock:
            if outfit_key in self._jobs and self._jobs[outfit_key].phase != PHASE_FAILED:
                raise ValueError(f"造型 {outfit_key!r} 的 3D 资产正在建,别重复提交")

        master = self._fetch(master_url)
        report = precheck_master_bytes(master)
        if not report["accepted"]:
            raise MasterPrecheckFailed(report)

        self._start(outfit_key, PHASE_BUILDING, master)
        return self.view(outfit_key)

    def approve(self, outfit_key: str, master_url: str) -> dict:
        """人点头 → ② 绑骨。**这道闸不会自己点头**,只有本方法能放行,而它只挂在
        面向人的端点上。"""
        state = self._builder.state(outfit_key)
        if state is not Render3DAssetState.AWAITING_REVIEW:
            raise ValueError(f"造型 {outfit_key!r} 处于 {state.value},没有待审模型可放行")
        self._builder.approve(outfit_key)
        self._start(outfit_key, PHASE_RIGGING, self._fetch(master_url))
        return self.view(outfit_key)

    def discard(self, outfit_key: str) -> dict:
        """人否掉待审模型 → 回到 ``absent``,下次建会重新生成(再付一次图生 3D)。"""
        state = self._builder.state(outfit_key)
        if state is not Render3DAssetState.AWAITING_REVIEW:
            raise ValueError(f"造型 {outfit_key!r} 处于 {state.value},没有待审模型可否掉")
        self._builder.discard(outfit_key)
        self._store.delete(f"{_URL_PREFIX}{RAW_KEY_PREFIX}{outfit_key}")
        with self._lock:
            self._jobs.pop(outfit_key, None)
        return self.view(outfit_key)

    # ── 内部 ─────────────────────────────────────────────────────────────
    def _start(self, outfit_key: str, phase: str, master: bytes) -> None:
        with self._lock:
            self._jobs[outfit_key] = _Job(phase)
        self._spawn(lambda: self._run(outfit_key, master))

    def _publish_for_review(self, outfit_key: str) -> None:
        """把待审模型也放到对象存储上。

        **不放的话这道闸没法用**:模型只躺在服务器磁盘上,人点"通过"时其实一眼都没看到,
        于是闸退化成一个必须点的按钮 —— 比没有闸更糟,它制造了"已经审过"的假象。
        """
        url_key = f"{_URL_PREFIX}{RAW_KEY_PREFIX}{outfit_key}"
        if self._store.get(url_key) is not None:
            return
        model = self._store.get(f"{RAW_KEY_PREFIX}{outfit_key}")
        if model is None:
            return
        try:
            self._store.put(url_key, self._publish(model).encode())
        except Exception:                              # noqa: BLE001 - 看不了不等于建失败
            logger.exception("[WINDUP] 待审模型上传失败 | outfit=%s", outfit_key)

    def _run(self, outfit_key: str, master: bytes) -> None:
        """两段付费调用共用这一条:``ensure`` 自己知道该走 ① 还是 ②。

        ``ModelAwaitingReview`` 不是失败,是 ① 干完了、停在闸上 —— 把它当失败会让
        用户看到一条红色报错,而实际上该看到的是"去看模型"。
        """
        try:
            rigged = self._builder.ensure(outfit_key, master, _SilentProgress())
        except ModelAwaitingReview:
            self._publish_for_review(outfit_key)
            with self._lock:
                self._jobs.pop(outfit_key, None)
            return
        except Exception as exc:                       # noqa: BLE001 - 后台线程兜底
            logger.exception("[WINDUP] 建 3D 资产失败 | outfit=%s", outfit_key)
            with self._lock:
                self._jobs[outfit_key] = _Job(PHASE_FAILED, f"{type(exc).__name__}: {exc}")
            return
        try:
            url = self._publish(rigged)
        except Exception as exc:                       # noqa: BLE001 - 同上
            logger.exception("[WINDUP] 绑骨模型上传失败 | outfit=%s", outfit_key)
            with self._lock:
                self._jobs[outfit_key] = _Job(
                    PHASE_FAILED,
                    f"绑骨已完成(积分已扣)但上传失败,重试不会重新扣费:{exc}",
                )
            return
        self._store.put(f"{_URL_PREFIX}{outfit_key}", url.encode())
        with self._lock:
            self._jobs.pop(outfit_key, None)


class _SilentProgress:
    """建资产跑在后台线程上,没有 SSE 连接可推;进度落日志。"""

    def step(self, stage: str, i: int, total: int, note: str = "") -> None:
        logger.info("[WINDUP] render3d %s %d/%d %s", stage, i, total, note)


# ── 真实装配 ────────────────────────────────────────────────────────────────


class _LazyModel3D:
    """腾讯云凭证在**真要花钱的那一刻**才解析。

    装配期解析的后果是:没配三渲二凭证的部署整个起不来,而那些部署里绝大多数请求
    根本不走这条路线 —— 一条没人用的路线不该有权否决整个服务的启动。
    """

    def __init__(self, allow_spend: bool) -> None:
        self._allow_spend = allow_spend

    def image_to_3d(self, master: bytes, *, want: str = "GLB") -> bytes:
        from windup_framework.providers.render3d import TencentModel3DProvider

        return TencentModel3DProvider(allow_spend=self._allow_spend).image_to_3d(
            master, want=want
        )


class _LazyAutoRig:
    def __init__(self, allow_spend: bool) -> None:
        self._allow_spend = allow_spend

    def rig(self, model: bytes, *, want: str = "GLB", motion=None):
        from windup_framework.providers.render3d import (
            TencentAutoRigProvider,
            TencentCosModelUploader,
        )

        provider = TencentAutoRigProvider(
            TencentCosModelUploader(), allow_spend=self._allow_spend
        )
        return provider.rig(model, want=want, motion=motion)


def _publish_model(data: bytes) -> str:
    """把绑骨模型放到对象存储,拿到 ``outfits[].model_3d_url`` 要的那个 URL。"""
    from windup_app.server.media.model import MediaUploadInput
    from windup_app.server.media.service import service as media_service

    return media_service.upload(
        data,
        MediaUploadInput(
            filename="rigged.glb",
            content_type="model/gltf-binary",
            size=len(data),
            category="model-3d",
        ),
    ).url


def _assemble() -> Render3DAssetOperations:
    """线上装配。``WINDUP_RENDER3D_ALLOW_SPEND`` 关着时端点照常在,只是点"建"会明说
    本部署不许花钱 —— 比不装好:不装的话前端连状态都读不到,用户看到的是坏页面
    而不是"这台机器没开这个功能"。

    落点目录**必须挂持久卷**,理由见 ``LocalDirAssetStore``。
    """
    root = pathlib.Path(os.getenv("WINDUP_RENDER3D_ASSET_DIR") or "var/render3d")
    allow_spend = os.getenv("WINDUP_RENDER3D_ALLOW_SPEND", "").strip().lower() in {
        "1", "true", "yes", "on",
    }
    store = LocalDirAssetStore(root / "assets")
    builder = Render3DAssetBuilder(
        model3d=_LazyModel3D(allow_spend),
        autorig=_LazyAutoRig(allow_spend),
        store=store,
        review=LocalDirModelReview(root / "review"),
        may_build_assets=allow_spend,
    )
    return Render3DAssetOperations(builder, store, _publish_model)


class _LazyOperations:
    """真有人调这些端点时才装配。

    装配会建落点目录,而 ``create_app()`` 每跑一次就装配一次 —— 包括每个测试用例。
    在工作目录里落一堆空目录不是功能,是副作用。
    """

    def __init__(self) -> None:
        self._inner: Render3DAssetOperations | None = None

    def _ops(self) -> Render3DAssetOperations:
        if self._inner is None:
            self._inner = _assemble()
        return self._inner

    def view(self, outfit_key: str) -> dict:
        return self._ops().view(outfit_key)

    def build(self, outfit_key: str, master_url: str) -> dict:
        return self._ops().build(outfit_key, master_url)

    def approve(self, outfit_key: str, master_url: str) -> dict:
        return self._ops().approve(outfit_key, master_url)

    def discard(self, outfit_key: str) -> dict:
        return self._ops().discard(outfit_key)


def default_operations() -> _LazyOperations:
    return _LazyOperations()
