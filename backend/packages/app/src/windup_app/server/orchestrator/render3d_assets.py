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
from collections.abc import Mapping
from enum import Enum
from typing import TYPE_CHECKING, Protocol, runtime_checkable

from windup_ai_engine.ports import ProgressPort
from windup_framework.providers.render3d.tencent import (
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

#: 图生 3D 产物在**上游**那边的 URL。给绑骨当云到云的输入(#860)。
#: 与 ``RAW_KEY_PREFIX`` 那份 bytes 分开存:两个用途、两种寿命 —— bytes 给人工确认闸
#: 渲给人看、要在整个审核期内稳定,而上游这个 URL 实测 24 小时过期。
URL_KEY_PREFIX = "rawurl:"
# 已提交、已计费、还没取回来的绑骨任务号。**费在提交那一刻就扣了**,之后的每一步
# (等待、下载、进程存活)都可能失败,而失败一次就重新提交等于再扣一次。存着它,
# 下次进来先零成本续取。取回来就删 —— 留着会让下一次真正的新请求被续取顶掉。
RIGJOB_KEY_PREFIX = "rigjob:"

# 两段的报价。**不在这里抄数字**,从计费实现取 —— 抄一份过去,供应商调价时两处会分叉,
# 而分叉的那一份正是给用户看的成本提示(告知了错的价钱比不告知更糟)。
# ``CREDITS["Normal"]`` 是本管线用的生成模式(非 PBR、单视图),与 ``TencentModel3DProvider``
# 的默认档一致。
MODEL3D_CREDITS = CREDITS["Normal"]
AUTORIG_CREDITS = RIG_CREDITS
BUILD_CREDITS = MODEL3D_CREDITS + AUTORIG_CREDITS

# ── 产品动作 → 绑骨预设动作 ─────────────────────────────────────────────────
#
# 绑骨接口一次只吃一个 ``MotionType``,**一次绑骨 = 一个动作片段**。所以这张表回答的是
# "某个产品动作该烘哪个预设",而不是"一份资产能出哪些动作"(后者恒为一个)。
#
# 值为 ``None`` 表示**这条路线不接这个动作**,不是待补:
#
#   - ``attack``:预设库里只有 thrust(16)/ kick(18) 两个近似项,而产品的攻击按运动
#     拓扑分四型(sweep / thrust / project / lunge,见 ``AttackArchetype``)。拿 thrust
#     顶 sweep 会渲出一段"直刺"冒充"横挥" —— 帧数、时长、成色全部正常,没有一道会红。
#     要接它得先实测出 sweep 类预设的编号,那是另一件事。
#   - ``custom``:用户自述动作,预设库里按定义就没有对应项;映射到任何一个预设都是拿
#     别的动作冒充。
#
# 两者继续走 i2v —— 那条路线本来就吃自然语言描述,不是降级。
#
# 键取 ``orchestrator.model.ActionType`` 的取值(不 import 那个枚举:本模块是准备整体
# 搬去产品仓的,它不该依赖 ORM 层)。取值域由 ``test_render3d_motion`` 钉住。
ACTION_MOTIONS: Mapping[str, str | None] = {
    "walk": "walk",
    "idle": "idle",
    "jump": "jump",
    "attack": None,
    "custom": None,
}

# 建资产时烘进模型的那个动作。**是常量,不是部署开关。**
#
# 一份绑骨产物只带一个动作片段,"这份资产会哪个动作"必须与它真实烘进去的那个永远一致。
# 做成开关的话,改开关会让**已经建好的**资产开始声称自己会另一个动作,而渲出来的仍是
# 旧的那段 —— 又是一次"帧数、时长、成色全正常"的静默错。要按造型选动作,得先有一个
# 能承载"每动作一份资产"的落点与 URL 字段(见本模块开头的成本说明)。
#
# 选 walk 而不是 idle:走 / 跑正是另外两条路线做不好的部分(i2v 各朝向互不一致、逐帧
# 路线腿不左右交替),而 idle 已经由 i2v 覆盖得不错。
BUILD_MOTION = "walk"

# 走本路线出得了的动作。资产只烘了 ``BUILD_MOTION``,别的动作**必须在派单之前被拒**:
# 模型里那唯一一个片段照样渲得出 32 张帧,拿走路帧当攻击交付不会有任何一处报错。
RENDERABLE_ACTIONS = frozenset(
    action for action, motion in ACTION_MOTIONS.items() if motion == BUILD_MOTION
)


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
    修它。若管线一口气从图生 3D 冲到绑骨+出帧,一个坏模型会连带浪费掉绑骨那笔计费和
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

        **注意这一步的代价**:重新生成要再付一次图生 3D。之所以还是删,
        是因为混元的模型改不动(生成即最终),留着一个不合格的模型只有两种下场 ——
        要么被误放行进绑骨(再赔一次绑骨计费和之后所有出帧),要么永远卡在闸上。
        """
        self._store.delete(f"{RAW_KEY_PREFIX}{outfit_key}")
        self._review.discard(outfit_key)

    def ensure(self, outfit_key: str, master: bytes, progress: ProgressPort) -> bytes:
        """取该造型的绑骨模型;没有且获准时才现建。

        建一次的计费 = 图生 3D + 绑骨,取值见本模块顶部常量,**每造型一次性**。
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
                f"{BUILD_CREDITS} 积分:图生 3D {MODEL3D_CREDITS} + "
                f"绑骨 {AUTORIG_CREDITS})。要现建请显式授权花钱,"
                "或先把资产备好,或改走 video_i2v。"
            )
        return self._build(outfit_key, master, progress)

    # ── 内部 ─────────────────────────────────────────────────────────────
    def _build(self, key: str, master: bytes, progress: ProgressPort) -> bytes:
        """① 图生 3D →(人工确认)→ ② 绑骨并烘入 :data:`BUILD_MOTION`。**按次计费,每造型一次性。**

        中间那道人工确认是硬停点,原因见 :class:`ModelReviewGate`:模型不可事后修改,
        坏模型只能重生成,所以要在**花绑骨的钱之前**让人看一眼。

        **绑骨必须带动作。** 不带 ``MotionType`` 的请求接口照样受理、照样扣 10 积分,
        只是产物里零个动画片段(实测:带 walk 的产物 1 个 AnimationStack,不带的 0 个;
        图生 3D 出的原始模型本身也是 0 个)。出帧台拿到零片段就出不了动作,而绑骨、
        取件、落点每一步都"成功"。
        """
        raw_key = f"{RAW_KEY_PREFIX}{key}"

        # 图生 3D 的产物单独存一份。**这不是冗余** —— 待审期间会有第二次、第三次调用走到
        # 这里,若不存,每次都要重付一遍图生 3D 的钱,而停点的本意恰恰是省钱。
        model = self._store.get(raw_key)
        if model is None:
            progress.step("assets", 0, 2, "造型级 3D 资产未就绪:图生 3D(按次计费)")
            model, upstream_url = _image_to_3d(self._model3d, master)
            self._store.put(raw_key, model)
            if upstream_url:
                # 上游那个 URL 单独存一份,给绑骨当**云到云**的输入 —— 它是上游自家的
                # 文件,交回给同一个上游就不用我们中转(省每资产约 36MB,#860)。
                # 与 raw_key 那份 bytes 是两个用途:bytes 给人工确认闸渲给人看,
                # 那个 URL 必须在整个审核期内稳定;上游这个 24 小时会过期。
                self._store.put(f"{URL_KEY_PREFIX}{key}", upstream_url.encode())
            logger.info("图生 3D 产物已落点 key=%s bytes=%d 云到云=%s",
                        raw_key, len(model), bool(upstream_url))

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

        progress.step("assets", 1, 2, f"模型已确认,自动绑骨并烘入 {BUILD_MOTION} 动作(按次计费)")
        rigged: RiggedModel = _rig(self._autorig, model,
                                   self._store.get(f"{URL_KEY_PREFIX}{key}"),
                                   motion=BUILD_MOTION,
                                   store=self._store,
                                   job_key=f"{RIGJOB_KEY_PREFIX}{key}#{BUILD_MOTION}")
        if rigged.motion is None:
            # 不带动作的绑骨产物在下游**每一道闸前都是正常的**:格式对、28 骨对、体积对,
            # 只是出帧台拿到零个动画片段。存下来就等于把 10 积分买来的哑模型挂成 READY,
            # 用户侧的症状是"三渲二根本出不了动作",而没有任何一处报错指向绑骨这一步。
            raise RuntimeError(
                f"绑骨产物里没有动作片段(请求的是 {BUILD_MOTION!r})—— 拒绝当成就绪资产存下。"
                "绑骨请求体缺 MotionType 时接口照样成功、照样扣费,产物只是零动画。"
            )

        # 存的是**绑骨后**的产物:它是渲帧真正要的那个,存中间的 model 等于下次还得再绑一次。
        self._store.put(key, rigged.data)
        logger.info("造型级 3D 资产已落点 key=%s fmt=%s", key, rigged.fmt)
        return rigged.data

    def add_motion(self, key: str, motion: str, progress: ProgressPort) -> bytes:
        """给**已建好**的造型再烘一个动作片段。**只花绑骨那一笔**(见 AUTORIG_CREDITS)。

        为什么能只花一笔:图生 3D 的产物一直留在 ``raw:`` 那份落点上(只有 discard 会删
        它),所以这里直接拿它再绑一次骨,不重付图生 3D。这也是这个方法存在的全部理由 ——
        用 ``ensure`` 再跑一遍会连图生 3D 一起重付,而那份模型明明还在。

        一份绑骨产物只带一个动作片段(接口一次只吃一个 MotionType),所以每个动作各存一份,
        键是 ``{造型键}#{动作}``。**不覆盖主产物** —— 覆盖等于用户为第二个动作付的钱把
        第一个顶掉。

        Raises:
            ValueError: 这个造型还没建过资产(没有 raw),或动作名不在 ``ACTION_MOTIONS``
                的可烘集合里。两种都在花钱之前拒。
        """
        want = ACTION_MOTIONS.get(motion)
        if want is None:
            bakeable = sorted(a for a, m in ACTION_MOTIONS.items() if m)
            raise ValueError(
                f"{motion!r} 走不了三渲二(可烘的是 {bakeable});"
                "attack / custom 的运动拓扑没有对应的预设动作,继续走 i2v。"
            )
        raw = self._store.get(f"{RAW_KEY_PREFIX}{key}")
        if raw is None:
            raise ValueError(
                "这个造型还没有 3D 模型,先建资产再加动作 —— 现建的话要连图生 3D 一起付。"
            )
        if not self._review.is_approved(key):
            raise ValueError("这个造型的 3D 模型还没被确认放行,先看过模型再加动作。")

        motion_key = f"{key}#{want}"
        cached = self._store.get(motion_key)
        if cached is not None:
            return cached                      # 已经烘过这个动作,不重复付费

        progress.step("assets", 0, 1, f"为 {motion} 再绑一次骨并烘入(按次计费)")
        # 追加动作同样走云到云:上游 URL 还在就不用把 18MB 再中转一遍(#860)。
        rigged: RiggedModel = _rig(self._autorig, raw,
                                   self._store.get(f"{URL_KEY_PREFIX}{key}"),
                                   motion=want,
                                   store=self._store,
                                   job_key=f"{RIGJOB_KEY_PREFIX}{key}#{want}")
        if rigged.motion is None:
            # 与主产物那条同一个理由:零片段的产物在下游每一道闸前都正常,存下来就是
            # 把 10 积分买来的哑模型挂成可用。
            raise RuntimeError(
                f"绑骨产物里没有动作片段(请求的是 {want!r})—— 拒绝当成就绪资产存下。"
            )
        self._store.put(motion_key, rigged.data)
        logger.info("造型追加动作已落点 key=%s motion=%s", motion_key, want)
        return rigged.data

def _image_to_3d(provider, master: bytes) -> tuple[bytes, str | None]:
    """图生 3D,顺带取回上游那个产物 URL。

    provider 没有 ``image_to_3d_with_url`` 时退回旧方法、URL 给 None —— 测试里的桩与
    别的实现不该因为这个新增能力而全部要改。
    """
    fn = getattr(provider, "image_to_3d_with_url", None)
    if fn is None:
        return provider.image_to_3d(master, want="GLB"), None
    return fn(master, want="GLB")


def _model_not_public():
    """上游 URL 不可取时那个异常类型。局部取,免得模块顶层耦合到具体 provider。"""
    from windup_framework.providers.render3d import ModelNotPublicError

    return ModelNotPublicError


_MODEL_NOT_PUBLIC = _model_not_public()


def _rig(provider, model: bytes, upstream_url: bytes | None, *, motion: str,
         store: CharacterAssetStore | None = None, job_key: str = ""):
    """绑骨。有上游 URL 就走**云到云**,没有就退回传 bytes。

    退回不是可有可无的:上游 URL 会过期(24 小时),而人可能隔天才放行;
    存量资产也没有这份 URL。退回那条路仍然可用,只是要多走一次中转。

    给了 ``store``/``job_key`` 就带**断点续取**:提交成功即落盘任务号,下一次进来
    先零成本取一遍那个任务的产物。没有它的话,提交之后的任何失败都让已扣的费作废。
    """
    # 续取与落盘是一对,缺一没意义,所以一起按 provider 是否有 fetch 来开关。
    resumable = store is not None and bool(job_key) and hasattr(provider, "fetch")
    if resumable:
        prior = store.get(job_key)
        if prior:
            job_id = prior.decode()
            try:
                got = provider.fetch(job_id, want="GLB", motion=motion)
                logger.info("续取上次已计费的绑骨产物 JobId=%s,没有重复提交", job_id)
                store.delete(job_key)
                return got
            except Exception as exc:      # noqa: BLE001 —— 续取是尽力而为
                # 任务号可能已过期/上游把它判失败了。删掉再走正常提交,
                # 留着会让每一次重试都先白等一轮。
                logger.info("JobId=%s 续不回来(%s),按新任务提交", job_id, exc)
                store.delete(job_key)

    # 只有支持续取的 provider 才收得下这个钩子。不支持的(测试替身、别家实现)连
    # 关键字都不该看见 —— 传过去是 TypeError,而这里本来就没它的事。
    hook = ({"on_submitted": lambda job_id: store.put(job_key, job_id.encode())}
            if resumable else {})
    url = (upstream_url or b"").decode() if upstream_url else ""
    fn = getattr(provider, "rig_from_url", None)
    got = None
    if url and fn is not None:
        try:
            got = fn(url, "GLB", want="GLB", motion=motion, **hook)
        except _MODEL_NOT_PUBLIC:
            # URL 过期或不再可取 —— 退回中转,别让整条建资产失败。
            logger.info("上游 URL 不可用,退回经应用机中转绑骨")
    if got is None:
        got = provider.rig(model, want="GLB", motion=motion, **hook)
    if resumable:
        # 取回来了就把任务号清掉。留着的话,这个造型下次被丢弃重建时会**续到上一版
        # 模型的绑骨产物** —— 拿到的是别的模型,而且哪一道闸都拦不住。
        store.delete(job_key)
    return got
