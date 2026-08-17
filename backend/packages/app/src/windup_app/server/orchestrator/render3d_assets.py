"""角色级 3D 资产的建造与落点 —— 三渲二里**花钱的那两段**。

    母版图 bytes ──①图生 3D──▶ 3D 模型 ──(人工确认)──▶ ②自动绑骨 ──▶ 绑骨模型 bytes
                                                                        │
                                                              存进 CharacterAssetStore
                                                                        │
                            server 下次直接取出来喂 CharacterGeneratorPort.generate_rendered

**渲帧那一段不在这里**,它在 ai_engine 的 ``RenderFrameStrategy`` 里(纯本地、零 API
成本)。花钱的留 server、只管渲的留引擎 —— 捆在一个 port 后面就看不出哪一步花钱。

━━ 为什么要有 CharacterAssetStore ━━

三段的成本结构完全不同:①图生 3D 与 ②自动绑骨按积分计费、**每造型一次性**,③渲帧
零 API、每动作每朝向都免费。没有落点,①② 就得每个动作重跑一次 —— 一个造型做 10 个
动作,成本差一个数量级(Refs 1024XEngineer/Windup#121)。所以这个 store 不是"存得
整齐一点",它是这条路线成本优势能否成立的开关。

━━ 键取造型 id ━━

**键是造型(outfit)的稳定 id,不是角色 id、也不是 ``CharacterCard`` 上的任何字段。**

- 挂造型一级(#121):外观挂在造型上(每个 outfit 自带 ``preview_url``),角色级只有一张
  参考图,同一角色的不同造型共用不了一个 3D 模型。
- 由调用方显式传入,不从 card 反查:card 由 executor 现搭,只有 name 和 desc 是可靠的,
  拿它上面别的字段当键会恒为 None —— 而单元测试直接构造 card,照样全绿。
- 不用 ``name``:它不唯一(落库时甚至可以为 null,#123),拿它当键会让两个同名角色互相
  复用彼此的模型 —— "看起来省钱、实际出错角色"的静默错误。

━━ 生成出来的 3D 模型要先给人看过才往下走 ━━

①② 之间有一道**人工确认停点**(:class:`ModelReviewGate`)。模型不可事后修改,坏模型
只能重生成;一口气冲到绑骨+出帧的话,一个坏模型会连带浪费绑骨的积分和后面所有出帧,
而人要看完一整套序列帧才发现锅在最上游。停点放在图生 3D 之后、绑骨之前,是信息最全
而花费最少的位置。待审期间 ① 的产物**单独存一份**,故反复调用不会重付那笔钱。
"""
from __future__ import annotations

import hashlib
import logging
import pathlib
from enum import Enum
from typing import TYPE_CHECKING, Protocol, runtime_checkable

from windup_ai_engine.ports import ProgressPort
from windup_framework.providers.render3d.tencent import (
    CREDIT_PRICE_CNY,
    CREDITS,
    RIG_CREDITS,
)

if TYPE_CHECKING:
    from windup_framework.providers.render3d import (
        AutoRigProvider,
        Model3DProvider,
        RiggedModel,
    )

logger = logging.getLogger(__name__)

# ① 出了模型但还没绑骨的产物,存在同一个 store 里的这个键前缀下。**别在别处再写一遍
# 字面量** —— 待审模型"在哪"这件事有两个说法时,放行与展示会指向不同的文件。
RAW_KEY_PREFIX = "raw:"

# 两段的报价。**不在这里抄数字**,从计费实现取 —— 抄一份过去,供应商调价时两处会分叉,
# 而分叉的那一份正是给用户看的成本提示(告知了错的价钱比不告知更糟)。
# ``CREDITS["Normal"]`` 是本管线用的生成模式(非 PBR、单视图),与 ``TencentModel3DProvider``
# 的默认档一致。
MODEL3D_CREDITS = CREDITS["Normal"]
AUTORIG_CREDITS = RIG_CREDITS
BUILD_CREDITS = MODEL3D_CREDITS + AUTORIG_CREDITS
BUILD_CNY = round(BUILD_CREDITS * CREDIT_PRICE_CNY, 2)


class Render3DAssetState(str, Enum):
    """一个造型的 3D 资产处在哪一步。**状态由落点推出来,不单独存一份** ——
    存第二份就有第二个真相,而这两者不同步时用户看到的是"已就绪"、渲帧拿到的是空。
    """

    ABSENT = "absent"                    # 什么都没有,点"建"会开始花钱
    AWAITING_REVIEW = "awaiting_review"  # ① 已出模型,卡在人工确认闸上
    READY = "ready"                      # ② 已绑骨,渲帧可直接用


@runtime_checkable
class CharacterAssetStore(Protocol):
    """角色级派生资产(绑好骨的 3D 模型)的落点。

    **必须是跨进程持久的** —— 进程内缓存等于每次重启都重付一遍 ①②,而那正是本文件
    开头那笔一个数量级的差价。
    """

    def get(self, key: str) -> bytes | None: ...

    def put(self, key: str, data: bytes) -> None: ...

    def delete(self, key: str) -> None:
        """删掉一份产物。给"模型不合格、重新生成"用 —— 不删的话下次调用会把同一个坏
        模型再交一遍给人审,重生成的入口就成了死键。"""
        ...


class LocalDirAssetStore(CharacterAssetStore):
    """落在本地目录的实现。

    **部署注意:这个目录必须挂持久卷。** 落在容器可写层里的话,每次重建镜像/重启都会
    清空,于是角色级资产退化成"每次部署后第一个动作重付 ①②"。要在多副本后端上用,
    应换成对象存储实现(同一个 Protocol,换注入即可)—— 那一步等 #121 拍板后做。
    """

    def __init__(self, root: pathlib.Path) -> None:
        self._root = root
        self._root.mkdir(parents=True, exist_ok=True)

    def _path(self, key: str) -> pathlib.Path:
        # key 里可能有 URL / 路径分隔符,哈希成扁平文件名;保留前缀便于人肉排查。
        digest = hashlib.sha256(key.encode()).hexdigest()[:32]
        return self._root / f"rigged_{digest}.bin"

    def get(self, key: str) -> bytes | None:
        p = self._path(key)
        return p.read_bytes() if p.is_file() else None

    def put(self, key: str, data: bytes) -> None:
        # 先写临时文件再 rename:半截文件被当成"资产已就绪"会让下一次渲染拿到坏模型,
        # 而那时钱已经花完,错误却显形在出帧台("Bad glTF"),排查方向整个跑偏。
        p = self._path(key)
        tmp = p.with_suffix(".part")
        tmp.write_bytes(data)
        tmp.replace(p)

    def delete(self, key: str) -> None:
        self._path(key).unlink(missing_ok=True)


class SpendNotAuthorized(ValueError):
    """要花钱建资产,但本部署没打开花钱开关。

    单拎一个类型是给上层用的:它与"造型 id 缺失""母版拉不到"这些同样抛 ValueError 的
    输入问题修法完全不同(前者改部署配置,后者改请求),压成一种就只能靠比对消息文本
    分支 —— 而消息会改。继承 ValueError 让既有的 ``pytest.raises(ValueError)`` 仍然成立。
    """


class ModelAwaitingReview(RuntimeError):
    """3D 模型已生成、**在等人看过点头**,还不能往下走。

    不是错误,是流程里的一个停点。故消息里带着"去哪看"和"怎么放行",让收到它的人
    知道下一步该做什么,而不是以为管线坏了。
    """

    def __init__(self, key: str, where: str, how: str) -> None:
        super().__init__(f"3D 模型待人工确认(key={key})。看这里:{where};放行:{how}")
        self.key = key
        self.where = where


@runtime_checkable
class ModelReviewGate(Protocol):
    """生成出来的 3D 模型,**必须先给人看过、点头,才允许往下花钱绑骨 / 出帧**。

    为什么这一道非要有:混元生成的 3D 模型**没法事后好好修改**,等于"生成即最终" ——
    拓扑、绑点、配件都在生成那一步定死。所以模型不合格时唯一的补救是重新生成,而不是
    修它。若管线一口气从图生 3D 冲到绑骨+出帧,一个坏模型会连带浪费掉绑骨的 10 积分和
    后面所有出帧,人还要看完一整套序列帧才发现问题出在最上游那一步。

    把停点放在图生 3D **之后、绑骨之前**,是因为这里是信息最全而花费最少的位置:
    模型已经在手上可以旋转着看,而下游的钱一分还没花。
    """

    def submit(self, key: str, model: bytes, fmt: str) -> str:
        """把待审模型交出去,返回"人该去哪看"的位置说明。"""
        ...

    def is_approved(self, key: str) -> bool:
        """人是否已点头。**不得自动变 True** —— 那就等于这道闸不存在。"""
        ...

    def approve(self, key: str) -> None:
        """人看过并点头。**只允许由人的显式操作触达**(CLI、或前端那个"通过"按钮),
        管线自身任何一条路径都不得调它 —— 会自己点头的闸就是没有闸。"""
        ...

    def discard(self, key: str) -> None:
        """人看过并否掉:丢弃待审模型。混元的模型改不动,不合格只能重生成,
        所以否掉必须真的把它删了 —— 留着的话下次调用会把同一个坏模型再交一遍。"""
        ...


class LocalDirModelReview(ModelReviewGate):
    """落本地目录 + 一个批准标记文件。

    放行方式刻意做成"人手动建一个标记文件",而不是任何形式的超时自动放行:
    自动放行的闸等于没有闸,只是把"没人看"伪装成"看过了"。
    """

    def __init__(self, root: pathlib.Path) -> None:
        self._root = root
        self._root.mkdir(parents=True, exist_ok=True)

    def _stem(self, key: str) -> pathlib.Path:
        return self._root / hashlib.sha256(key.encode()).hexdigest()[:32]

    def submit(self, key: str, model: bytes, fmt: str) -> str:
        model_path = self._stem(key).with_suffix(f".{fmt.lower()}")
        if not model_path.is_file():                 # 已交过就别重写,人可能正在看
            tmp = model_path.with_suffix(".part")
            tmp.write_bytes(model)
            tmp.replace(model_path)
        (self._stem(key).with_suffix(".key.txt")).write_text(key, encoding="utf-8")
        return str(model_path)

    def is_approved(self, key: str) -> bool:
        return self._stem(key).with_suffix(".approved").is_file()

    def approve(self, key: str) -> None:
        """人看过之后放行(给 CLI / 运维 / 前端那个"通过"按钮用;管线自己**不会**调这个)。"""
        self._stem(key).with_suffix(".approved").write_text("ok", encoding="utf-8")

    def discard(self, key: str) -> None:
        """否掉待审模型。连批准标记一起删:留着标记而删了模型,下次生成出来的新模型
        会被这枚旧标记直接放行,人一眼都没看到就进了绑骨。"""
        stem = self._stem(key)
        for path in self._root.glob(f"{stem.name}.*"):
            path.unlink(missing_ok=True)


class Render3DAssetBuilder:
    """把①图生 3D + ②自动绑骨拼成"母版 → 该造型的绑骨模型",并落点复用。

    **本类不渲帧。** 渲帧在 ai_engine 的 ``RenderFrameStrategy``(零 API 成本)。
    """

    def __init__(
        self,
        model3d: Model3DProvider,
        autorig: AutoRigProvider,
        store: CharacterAssetStore,
        review: ModelReviewGate,
        *,
        may_build_assets: bool = False,
    ) -> None:
        self._model3d = model3d
        self._autorig = autorig
        self._store = store
        self._review = review
        self._may_build_assets = may_build_assets

    @property
    def may_build_assets(self) -> bool:
        """本实例获准花钱建资产没有。给上层**在起后台任务之前**问 —— 起了再失败的话,
        用户看到的是"建到一半炸了",而事实是这台机器根本没打算建。"""
        return self._may_build_assets

    def get(self, outfit_key: str) -> bytes | None:
        """已就绪的绑骨模型;``None`` = 还没有。**不花钱、无副作用。**

        这是 server 决定"这次调 generate 还是 generate_rendered"时用的那个判断
        (#122:判据由 server 出,不挂在引擎的 port 上)。
        """
        return self._store.get(outfit_key) if outfit_key else None

    def state(self, outfit_key: str) -> Render3DAssetState:
        """该造型走到哪一步了。**不花钱、无副作用**,给状态查询端点用。"""
        if outfit_key and self._store.get(outfit_key) is not None:
            return Render3DAssetState.READY
        if outfit_key and self._store.get(f"{RAW_KEY_PREFIX}{outfit_key}") is not None:
            return Render3DAssetState.AWAITING_REVIEW
        return Render3DAssetState.ABSENT

    def approve(self, outfit_key: str) -> None:
        """人点头放行。**本类不会自己调它** —— 调用点只有面向人的入口(端点 / CLI)。

        放行本身不绑骨:绑骨是下一次 :meth:`ensure` 的事,那里才有母版和进度回调。
        """
        self._review.approve(outfit_key)

    def discard(self, outfit_key: str) -> None:
        """人否掉待审模型:删待审件,回到 ``ABSENT``,下次 :meth:`ensure` 重新生成。

        **注意这一步的代价**:重新生成要再付一次图生 3D 的 20 积分。之所以还是删,
        是因为混元的模型改不动(生成即最终),留着一个不合格的模型只有两种下场 ——
        要么被误放行进绑骨(再赔 10 积分和之后所有出帧),要么永远卡在闸上。
        """
        self._store.delete(f"{RAW_KEY_PREFIX}{outfit_key}")
        self._review.discard(outfit_key)

    def ensure(self, outfit_key: str, master: bytes, progress: ProgressPort) -> bytes:
        """取该造型的绑骨模型;没有且获准时才现建。

        建一次约 ¥3.60(图生 3D 20 积分 + 绑骨 10 积分 × ¥0.12),**每造型一次性**。
        ``may_build_assets=False``(默认)时不建 —— 一个 web 请求不该顺手扣这笔钱,
        那正是"无人值守烧钱"。要放开就显式设 ``WINDUP_RENDER3D_ALLOW_SPEND``。
        """
        if not outfit_key:
            raise ValueError(
                "缺少造型 id,无法定位/复用该造型的 3D 资产。继续跑会让图生 3D + 绑骨"
                "按动作重复计费(每造型一次性 → 每动作一次),故在花钱之前停下。"
            )
        rigged_bytes = self._store.get(outfit_key)
        if rigged_bytes is not None:
            return rigged_bytes
        if not self._may_build_assets:
            raise SpendNotAuthorized(
                f"造型 {outfit_key!r} 的 3D 资产未就绪,而本实例未获准建(建一次 "
                f"{BUILD_CREDITS} 积分,约 ¥{BUILD_CNY}:图生 3D {MODEL3D_CREDITS} + "
                f"绑骨 {AUTORIG_CREDITS})。要现建请显式授权花钱,"
                "或先把资产备好,或改走 video_i2v。"
            )
        return self._build(outfit_key, master, progress)

    # ── 内部 ─────────────────────────────────────────────────────────────
    def _build(self, key: str, master: bytes, progress: ProgressPort) -> bytes:
        """① 图生 3D →(人工确认)→ ② 绑骨。**按次计费,每造型一次性。**

        中间那道人工确认是硬停点,原因见 :class:`ModelReviewGate`:模型不可事后修改,
        坏模型只能重生成,所以要在**花绑骨的钱之前**让人看一眼。
        """
        raw_key = f"{RAW_KEY_PREFIX}{key}"

        # 图生 3D 的产物单独存一份。**这不是冗余** —— 待审期间会有第二次、第三次调用走到
        # 这里,若不存,每次都要重付一遍图生 3D 的钱,而停点的本意恰恰是省钱。
        model = self._store.get(raw_key)
        if model is None:
            progress.step("assets", 0, 2, "造型级 3D 资产未就绪:图生 3D(按次计费)")
            model = self._model3d.image_to_3d(master, want="GLB")
            self._store.put(raw_key, model)
            logger.info("图生 3D 产物已落点 key=%s bytes=%d", raw_key, len(model))

        where = self._review.submit(key, model, "GLB")
        if not self._review.is_approved(key):
            progress.step("assets", 1, 2, "3D 模型已生成,等人工确认后才继续绑骨")
            raise ModelAwaitingReview(
                key,
                where,
                "旋转着看:把待审的 .glb 放到一个静态服务下用 three.js 的 GLTFLoader "
                "+ OrbitControls 开(浏览器禁止 file:// 加载本地模型,必须走 http://localhost);"
                "确认可用就在同目录建一个同名 .approved 空文件放行;"
                "不合格则删掉待审模型重新生成 —— 混元的模型改不动,只能重生成",
            )

        progress.step("assets", 1, 2, "模型已确认,自动绑骨(按次计费,10 积分)")
        rigged: RiggedModel = self._autorig.rig(model, want="GLB")

        # 存的是**绑骨后**的产物:它是渲帧真正要的那个,存中间的 model 等于下次还得再绑一次。
        self._store.put(key, rigged.data)
        logger.info("造型级 3D 资产已落点 key=%s fmt=%s", key, rigged.fmt)
        return rigged.data
