"""生成任务领域模型。"""

from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import StrEnum
from typing import Any


# -- 枚举 ----------------------------------------------------------------

class GenerationType(StrEnum):
    """生成任务类型——每新增一种生成能力，在此加一个成员。"""

    CHARACTER_IMAGE = "character_image"    # 角色立绘 / 头像
    CHARACTER_ACTION = "character_action"  # 角色动作（walk / idle / attack / jump / custom）


class ActionType(StrEnum):
    """角色动作子类型。"""

    WALK = "walk"
    IDLE = "idle"
    ATTACK = "attack"
    JUMP = "jump"
    CUSTOM = "custom"


class TaskStatus(StrEnum):
    """生成任务状态。"""

    PENDING = "pending"        # 排队中
    RUNNING = "running"        # 生成中
    COMPLETED = "completed"    # 成功
    FAILED = "failed"          # 失败


# -- 入参（策略各自持有自己的输入模型）----------------------------------

@dataclass
class CharacterImageInput:
    """角色图片生成入参。"""

    reference_image_url: str
    prompt: str = ""
    negative_prompt: str = ""
    width: int = 1024
    height: int = 1024
    num_images: int = 1  #默认生成一张，后续可根据业务来选择合适数目



@dataclass
class CharacterActionInput:
    """角色动作生成入参。"""

    character_id: int
    action_type: ActionType
    custom_prompt: str | None = None            # CUSTOM 时必填
    reference_video_url: str | None = None      # 可选参考视频
    reference_image_urls: list[str] = field(default_factory=list)  # 可选参考图片
    num_frames: int = 16                      # 默认16帧数，后续可根据业务来选择。


# -- 出参 ----------------------------------------------------------------

@dataclass
class GenerationResult:
    """单次生成结果。"""

    urls: list[str] = field(default_factory=list)   # 生成产物 URL（图片/视频）
    metadata: dict[str, Any] = field(default_factory=dict)


# -- 任务记录 ------------------------------------------------------------

@dataclass
class GenerationTask:
    """生成任务（贯穿整个生命周期）。"""

    id: int | None = None
    user_id: int = 0
    project_id: int | None = None
    task_type: GenerationType = GenerationType.CHARACTER_IMAGE
    status: TaskStatus = TaskStatus.PENDING
    input_payload: dict[str, Any] = field(default_factory=dict)
    result: GenerationResult | None = None
    error_message: str | None = None
    create_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    update_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))

    @property
    def is_terminal(self) -> bool:
        return self.status in (TaskStatus.COMPLETED, TaskStatus.FAILED)