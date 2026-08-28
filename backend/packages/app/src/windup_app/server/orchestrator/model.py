"""生成任务领域模型。

生成任务按类型区分：角色图片生成（→ ``Character.reference_image_url``）、
角色动作生成（→ ``character_data.outfits[].actions[].frames[]``）。
前端拿到生成结果后可直接回填 character 模块的对应字段。
"""

from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import StrEnum

from sqlalchemy import BigInteger, DateTime, Integer, JSON, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from windup_common.directions import ActionDirection
from windup_common.models import CharacterStance
from windup_framework.db import Base


# -- 枚举 ----------------------------------------------------------------


class GenerationType(StrEnum):
    """生成任务类型——每新增一种生成能力，在此加一个成员。"""

    CHARACTER_IMAGE = "character_image"  # 角色参考图
    CHARACTER_DIRECTION_SET = "character_direction_set"  # 一次生成项目所需全部母版方向
    CHARACTER_FOUR_VIEW = "character_four_view"  # 四向立绘 sheet
    CHARACTER_EIGHT_VIEW = "character_eight_view"  # 八向立绘 sheet
    CHARACTER_FIRST_FRAME = "character_first_frame"  # 四向 / 八向动作首帧
    CHARACTER_ACTION = "character_action"  # 角色动作帧序列


class ActionType(StrEnum):
    """角色动作子类型。"""

    WALK = "walk"
    IDLE = "idle"
    JUMP = "jump"
    ATTACK = "attack"
    CUSTOM = "custom"


# 动作类型 → 帧数(产品口径)。**这是唯一一份约定**:前端提交时不发 num_frames,
# 从任务的 input_payload 读回来用 —— 两边各写一个数,分叉时任务照跑、没有一处会红。
# 待机是原地小幅呼吸,32 帧里绝大多数帧之间没有差别,多出来的帧进不了有效循环,
# 却照样占抽帧、抠图、对齐、上传的工作量与存储。
ACTION_FRAME_COUNTS: dict[ActionType, int] = {
    ActionType.WALK: 32,
    ActionType.IDLE: 12,
    ActionType.JUMP: 32,
    ActionType.ATTACK: 32,
    ActionType.CUSTOM: 32,
}


def frames_for(action_type: ActionType) -> int:
    """该动作类型约定的帧数。"""
    return ACTION_FRAME_COUNTS[action_type]


class TaskStatus(StrEnum):
    """生成任务状态。"""

    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    PARTIAL = "partial"
    FAILED = "failed"


# -- 入参 ----------------------------------------------------------------


@dataclass
class CharacterImageInput:
    """角色图片生成入参。"""

    reference_image_url: str | None = None
    prompt: str = ""
    negative_prompt: str = ""
    width: int = 1024
    height: int = 1024
    # 候选数量由调用方决定；API 默认请求 3 张，并把可付费调用次数限制在 1–4。
    # ``None`` = 调用方没指定,在 __post_init__ 里解析成本层默认 2。解析放在这层
    # 而不是各个构造点:MQ 重建时若另写一份默认值,缺省就会从 2 变成另一份数。
    num_images: int | None = None
    direction: ActionDirection = ActionDirection.EAST

    def __post_init__(self) -> None:
        if self.num_images is None:
            self.num_images = 2


@dataclass
class CharacterDirectionSetInput:
    """基于已确认角色母版生成项目所需的其余真实方向。"""

    # 旧版方向集任务没有角色归属和锚点字段。它们只在 Worker 恢复时以 None
    # 重建，继续执行原来约定的全部方向；所有新请求仍由 API 强制写入这两项。
    character_id: int | None = None
    reference_image_url: str | None = None
    prompt: str = ""
    negative_prompt: str = ""
    width: int = 1024
    height: int = 1024
    num_images: int | None = None
    directions: list[ActionDirection] = field(default_factory=list)
    anchor_direction: ActionDirection | None = ActionDirection.EAST
    billing_attempt: int = 0

    def __post_init__(self) -> None:
        if self.reference_image_url is not None:
            self.reference_image_url = self.reference_image_url.strip() or None
        if self.character_id is not None:
            if not self.reference_image_url:
                raise ValueError("方向集生成必须绑定已确认角色母版")
            if self.anchor_direction not in self.directions:
                raise ValueError("已确认母版方向必须属于项目方向集")
        if self.num_images is None:
            self.num_images = 2


# 每张 sheet 候选要新生成的源方向数:south 正视复用已确认母版,镜像方向翻转上传不调模型。
FOUR_VIEW_MODEL_CALLS_PER_SHEET = 2  # east / north
EIGHT_VIEW_MODEL_CALLS_PER_SHEET = 4  # east / north / north_east / south_east


@dataclass
class CharacterViewSheetInput:
    """四向 / 八向立绘 sheet 入参。两口字段相同,task_type 由提交方法决定。"""

    character_id: int
    reference_image_url: str
    prompt: str = ""
    negative_prompt: str = ""
    width: int = 1024
    height: int = 1024
    # ``None`` = 调用方没指定。默认 1:sheet 比单张立绘贵,不沿用 image 的默认 3。
    num_images: int | None = None
    # 已确认母版必须是正视图,对应南向格。东向是侧视,本任务要图生图。
    anchor_direction: ActionDirection = ActionDirection.SOUTH

    def __post_init__(self) -> None:
        self.reference_image_url = (self.reference_image_url or "").strip()
        if not self.reference_image_url:
            raise ValueError("立绘 sheet 生成必须绑定已确认角色母版")
        if self.anchor_direction is not ActionDirection.SOUTH:
            raise ValueError("立绘 sheet 锚点必须是 south（正视图）")
        if self.num_images is None:
            self.num_images = 1


@dataclass
class CharacterFirstFrameInput:
    """四向 / 八向动作首帧:以该朝向立绘为参考,锁住朝向后换成动作起手姿态。"""

    character_id: int
    reference_image_url: str
    prompt: str
    direction: ActionDirection
    action_type: ActionType
    negative_prompt: str = ""
    width: int = 1024
    height: int = 1024
    num_images: int | None = None

    def __post_init__(self) -> None:
        self.reference_image_url = (self.reference_image_url or "").strip()
        if not self.reference_image_url:
            raise ValueError("动作首帧必须提供该朝向已确认的立绘")
        self.prompt = (self.prompt or "").strip()
        if not self.prompt:
            raise ValueError("动作首帧必须提供动作描述")
        if self.num_images is None:
            self.num_images = 3


@dataclass
class CharacterActionInput:
    """角色动作生成入参。"""

    character_id: int
    action_type: ActionType
    custom_prompt: str | None = None
    reference_video_url: str | None = None
    reference_image_urls: list[str] = field(default_factory=list)
    # ``None`` = 调用方没指定,在 __post_init__ 里按动作类型解析成约定值。解析放在这层
    # 而不是各个构造点:落库的 input_payload 是产线与前端读帧数的唯一来源,少解析一处
    # 就多一个自带默认值的构造点(MQ 重建入参就是其中一个)。
    num_frames: int | None = None
    # ── action_type=custom 才用到的两个(#239)──────────────────────────────
    # 这个动作是否循环播放。``None`` 原样往下传,由编排层兜成一次性:本层替调用方填默认值
    # 的话,"没给"和"明确给了 False"从这里起就再也分不开了。
    loop: bool | None = None
    # 这个动作有没有地面接触。``None`` 原样往下传,由编排层兜成"有" —— 本层替调用方填默认
    # 值的话,"没给"与"明确给了 True"从这里起就分不开了。飞 / 游 / 攀传 False,垂直对齐
    # 改按躯干中心走(#534);jump 不属此列,它腾空但要回地。
    ground_contact: bool | None = None
    # 视频模型。``None`` = 用部署配置的默认值。取值域为
    # ``ModelRegistry.chain(CHARACTER_ACTION)``(部署默认 + fallbacks);不在链上 → 入口
    # 报错,不到付费调用才失败。选中的型号表示这次从它开始试,由 Gateway 读 start_from_model。
    video_model: str | None = None
    # ── 三渲二(#192)────────────────────────────────────────────────────
    #
    # 这次动作属于哪个造型。3D 资产挂在造型一级(#121),没有它就连"按造型定位资产"
    # 都表达不出来。目前只被三渲二消费;推广成所有动作生成都按造型定位外观是 #253。
    outfit_id: str | None = None
    # 该造型的绑骨 3D 模型 URL。**有值 = 这次走三渲二**;None = 照旧走 video_i2v。
    #
    # 传 URL 而不是让编排层自己去查:与 reference_image_urls 同一口径 —— 取数在上层
    # 做完,"这次选了哪条路线"在入参上就可见,不是埋在某个分支里的隐式判断。
    model_3d_url: str | None = None
    # 这个造型已经烘好的动作片段(动作名 → 绑骨产物 URL)。由 web 层从 character_data
    # 读出来写进入参 —— 与 model_3d_url 同一个模式:这次按什么资产渲的,在任务入参上
    # 就是可见的,排查时不用猜当时 DB 是什么状态。
    rigged_motions: dict[str, str] = field(default_factory=dict)
    # 角色体型。``None`` 原样往下传,由编排层兜成双足 —— 本层替调用方填默认值的话,
    # "没给"与"明确给了 biped"从这里起就分不开了。判据见 prompt.adapter 的体型门禁。
    stance: CharacterStance | None = None
    direction: ActionDirection = ActionDirection.EAST

    def __post_init__(self) -> None:
        if self.num_frames is None:
            self.num_frames = frames_for(self.action_type)


# -- 出参（按任务类型细化，前端可直接回填 character 模块）------------------


@dataclass
class CharacterImageOutput:
    """角色图片生成结果。

    前端拿到 ``image_urls`` 后把候选图交给工作流节点选择；只有被确认的图片
    才写入 ``Character.reference_image_url``。
    """

    type: str = "character_image"
    image_urls: list[str] = field(default_factory=list)
    direction: ActionDirection = ActionDirection.EAST
    # 出图当场量的主体数(``ai_engine.slicing.quality.subject_blobs`` 的逐张读数)。与动作
    # 结果那份 ``quality`` 同键同语义:只落库、不参与前端回填,本层不据此判成败。
    # ``None`` = **没量过**,不是"量了没问题"。
    quality: dict | None = None


@dataclass
class CharacterFirstFrameOutput:
    """四向 / 八向动作首帧结果。前端按方向选一张写入首帧节点。"""

    type: str = "character_first_frame"
    image_urls: list[str] = field(default_factory=list)
    direction: ActionDirection = ActionDirection.EAST
    quality: dict | None = None


@dataclass
class DirectionImageResult:
    """方向集中的一个独立方向；成功项在局部重试时保持不动。"""

    direction: ActionDirection
    status: str = TaskStatus.PENDING.value
    image_urls: list[str] = field(default_factory=list)
    quality: dict | None = None
    error_message: str | None = None


@dataclass
class CharacterDirectionSetOutput:
    """一个 task_id 下的 1/4/8 向母版生成进度与产物。"""

    type: str = "character_direction_set"
    directions: list[DirectionImageResult] = field(default_factory=list)


def initial_direction_set_output(
    input: CharacterDirectionSetInput,
) -> CharacterDirectionSetOutput:
    """新任务跳过已确认锚点；没有锚点的旧任务继续生成全部方向。"""

    return CharacterDirectionSetOutput(
        directions=[
            DirectionImageResult(
                direction=direction,
                status=(
                    TaskStatus.COMPLETED.value
                    if direction is input.anchor_direction
                    else TaskStatus.PENDING.value
                ),
                image_urls=(
                    [input.reference_image_url]
                    if direction is input.anchor_direction
                    else []
                ),
            )
            for direction in input.directions
        ]
    )


@dataclass
class CharacterViewSheetCell:
    """sheet 上的一格。生成结果里每个方向都有已上传 URL。

    镜像格是源图水平翻转后重新上传,不是 ``image_url=null``。
    回填 ``templates[]`` 时镜像行仍只记 ``source_direction`` / ``mirror_x``,
    不把这张翻转图写成独立母版。
    """

    direction: ActionDirection
    image_url: str
    source_direction: ActionDirection | None = None
    mirror_x: bool = False

    def __post_init__(self) -> None:
        self.image_url = (self.image_url or "").strip()
        if not self.image_url:
            raise ValueError("立绘格子必须有 image_url")
        if self.mirror_x != (self.source_direction is not None):
            raise ValueError("镜像格必须同时给出 source_direction 与 mirror_x")
        if self.source_direction is not None and self.source_direction == self.direction:
            raise ValueError("格子不能镜像自身")


@dataclass
class CharacterViewSheetCandidate:
    """一张 sheet 候选:3×3 罗盘整图 URL + 有朝向的原图 URL(空槽不进 cells)。"""

    sheet_url: str
    cells: list[CharacterViewSheetCell] = field(default_factory=list)


@dataclass
class CharacterViewSheetOutput:
    """四向 / 八向立绘 sheet 结果。``type`` 与 ``task_type`` 相同。

    每张候选 = 3×3 ``sheet_url`` + 有朝向的 ``image_url``（镜像格是翻转后上传）。
    四向只填十字四格;空槽不进 ``cells``。
    确认后源方向回填 ``character_data.templates[]``；镜像行只记关系。
    """

    type: str
    sheets: list[CharacterViewSheetCandidate] = field(default_factory=list)
    quality: dict | None = None


@dataclass
class CharacterActionFrame:
    """动作帧——前端写入 ``CharacterAction.frames[]``。"""

    index: int
    image_url: str
    duration_ms: int | None = None


@dataclass
class CharacterActionOutput:
    """角色动作生成结果。

    前端拿到后写入 ``character_data.outfits[].actions[]``：
    ``action_type`` → ``CharacterAction.type``，
    ``frames`` + ``direction`` → ``CharacterAction.sequences[]``(一个方向一条,
    镜像方向按 ``CharacterActionSequence`` 的校验只存来源关系、不存帧),
    ``geometry`` → 导出契约的 ``anchor`` / ``footY``。

    ``quality`` / ``prompt_version`` 是引擎产出成色的账本(``ai_engine.ports.ActionQuality``
    的原样转录 + 提示词版本),不参与前端回填、只落库供后续对比——本层不据此判成败,
    见 executor 里"只记账不判决"的说明。
    """

    type: str = "character_action"
    action_type: str = ""
    frames: list[CharacterActionFrame] = field(default_factory=list)
    # 判官读数(``quality_gate.GateDecision.as_payload``)。``None`` = **没判**,不是
    # "判了没问题" —— 闸口默认不启用,把缺省读成"干净"会让 shadow 期的统计凭空多出一批
    # 从未判读过的样本。形状留 dict 而不是拆成字段:shadow 期正是要观察该记哪些东西,
    # 每加一个读数就改一次 ORM 反序列化的话,数据还没攒够就先僵住了。
    # 字段名不叫 quality:引擎那份本地像素成色(``ports.ActionQuality``)也要落到同一个
    # payload 里,两者来源与代价都不同,共用一个键会让先写的那份被后写的悄悄盖掉。
    judge: dict | None = None
    quality: dict | None = None
    prompt_version: str | None = None
    direction: ActionDirection = ActionDirection.EAST
    # 交付帧的落位几何(画布尺寸、主体锚点、脚线像素)。``None`` = 引擎没给,
    # 不是"用默认值" —— 消费方要能区分这两者,才不会把缺省当成实测。
    geometry: dict | None = None
    # 出帧台读到的骨架事实与根骨位移轨(#774)。与 ``geometry`` 同一个理由:
    # 只写进任务结果 JSON 而不进这个出参模型的话,**落库再读回就没了** ——
    # 查询接口与断线重连拿到的已完成任务缺这两样,而实时事件那条路有,
    # 两条路给出不同的结果。上面那条 geometry 的注释记的就是同一个坑。
    rig_facts: dict | None = None
    root_motion: list | None = None


# -- 任务记录 ------------------------------------------------------------


@dataclass
class GenerationTask:
    """生成任务（贯穿整个生命周期）。"""

    id: int | None = None
    user_id: int = 0
    project_id: int | None = None
    task_type: GenerationType = GenerationType.CHARACTER_IMAGE
    status: TaskStatus = TaskStatus.PENDING
    input_payload: dict | None = None
    result: (
        CharacterImageOutput
        | CharacterFirstFrameOutput
        | CharacterDirectionSetOutput
        | CharacterViewSheetOutput
        | CharacterActionOutput
        | None
    ) = None
    error_message: str | None = None
    create_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    update_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))

    @property
    def is_terminal(self) -> bool:
        return self.status in (
            TaskStatus.COMPLETED,
            TaskStatus.PARTIAL,
            TaskStatus.FAILED,
        )


# -- ORM -----------------------------------------------------------------


class GenerationTaskRecord(Base):
    """生成任务持久化记录。

    ``input_payload`` 和 ``result`` 以 JSON 存储；``result_type`` 标识
    ``result`` 的具体类型，读出后按类型反序列化为对应 dataclass。
    """

    __tablename__ = "windup_generation_task"

    id: Mapped[int] = mapped_column(
        BigInteger().with_variant(Integer, "sqlite"),
        primary_key=True,
        autoincrement=True,
    )
    user_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    project_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    task_type: Mapped[str] = mapped_column(
        Text,
        nullable=False,
        default=GenerationType.CHARACTER_IMAGE.value,
    )
    status: Mapped[str] = mapped_column(
        Text,
        nullable=False,
        default=TaskStatus.PENDING.value,
    )
    input_payload: Mapped[dict] = mapped_column(
        JSON().with_variant(JSONB, "postgresql"),
        nullable=False,
        default=dict,
    )
    result_type: Mapped[str | None] = mapped_column(Text, nullable=True)
    result: Mapped[dict | None] = mapped_column(
        JSON().with_variant(JSONB, "postgresql"),
        nullable=True,
    )
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)

    create_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )
    update_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )
