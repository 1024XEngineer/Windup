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
    """

    type: str = "character_action"
    action_type: str = ""
    frames: list[CharacterActionFrame] = field(default_factory=list)


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
