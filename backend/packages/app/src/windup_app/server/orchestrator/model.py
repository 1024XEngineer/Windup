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

from windup_common.models import CharacterStance
from windup_framework.db import Base


# -- 枚举 ----------------------------------------------------------------


class GenerationType(StrEnum):
    """生成任务类型——每新增一种生成能力，在此加一个成员。"""

    CHARACTER_IMAGE = "character_image"      # 角色参考图
    CHARACTER_ACTION = "character_action"    # 角色动作帧序列


class ActionType(StrEnum):
    """角色动作子类型。"""

    WALK = "walk"
    IDLE = "idle"
    JUMP = "jump"
    ATTACK = "attack"
    CUSTOM = "custom"


class TaskStatus(StrEnum):
    """生成任务状态。"""

    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
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
    num_images: int = 1


@dataclass
class CharacterActionInput:
    """角色动作生成入参。"""

    character_id: int
    action_type: ActionType
    custom_prompt: str | None = None
    reference_video_url: str | None = None
    reference_image_urls: list[str] = field(default_factory=list)
    num_frames: int = 16
    # ── action_type=custom 才用到的两个(#239)──────────────────────────────
    # 这个动作是否循环播放。``None`` 原样往下传,由编排层兜成一次性:本层替调用方填默认值
    # 的话,"没给"和"明确给了 False"从这里起就再也分不开了。
    loop: bool | None = None
    # 视频模型。``None`` = 用部署配置的默认值(kling-v2-5-turbo)。
    # 取值域见 executor.ALLOWED_VIDEO_MODELS —— 只开放两个,因为每个模型的入参形状不同
    # (image_list / input_reference / Fal 队列),全开等于把三套协议适配塞进一个改动。
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
    # 角色体型。``None`` 原样往下传,由编排层兜成双足 —— 本层替调用方填默认值的话,
    # "没给"与"明确给了 biped"从这里起就分不开了。判据见 prompt.adapter 的体型门禁。
    stance: CharacterStance | None = None


# -- 出参（按任务类型细化，前端可直接回填 character 模块）------------------


@dataclass
class CharacterImageOutput:
    """角色图片生成结果。

    前端拿到 ``image_urls`` 后写入 ``Character.reference_image_url``。
    单张也用列表: ``["url"]``。
    """

    type: str = "character_image"
    image_urls: list[str] = field(default_factory=list)


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
    ``frames`` → ``CharacterAction.frames[]``。

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
    result: CharacterImageOutput | CharacterActionOutput | None = None
    error_message: str | None = None
    create_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    update_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))

    @property
    def is_terminal(self) -> bool:
        return self.status in (TaskStatus.COMPLETED, TaskStatus.FAILED)


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
        Text, nullable=False,
        default=GenerationType.CHARACTER_IMAGE.value,
    )
    status: Mapped[str] = mapped_column(
        Text, nullable=False,
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
