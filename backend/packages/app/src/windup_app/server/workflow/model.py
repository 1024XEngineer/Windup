"""工作流画布领域模型。

功能型卡片体系：CHARACTER（角色实体）→ CANDIDATE（母版候选）/ ACTION（角色动作）/ EXPORT（资产导出）。
前端通过卡片 API 统一操作，后端负责持久化画布结构和生成任务状态。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import StrEnum


# -- 枚举 ----------------------------------------------------------------


class WorkflowStatus(StrEnum):
    """工作流状态。"""

    ACTIVE = "active"
    ARCHIVED = "archived"


class CardType(StrEnum):
    """卡片类型——功能型，按职责划分。"""

    CHARACTER = "character"     # 角色实体根节点
    CANDIDATE = "candidate"     # 母版候选
    ACTION = "action"           # 角色动作
    EXPORT = "export"           # 资产导出


class CardStatus(StrEnum):
    """卡片状态。"""

    DRAFT = "draft"             # 已创建，待用户填写
    GENERATING = "generating"   # 生成中
    COMPLETED = "completed"     # 完成
    FAILED = "failed"           # 失败
    INACTIVE = "inactive"       # 已失效（软删除）


class AttemptStatus(StrEnum):
    """生成尝试状态。"""

    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"


class Direction(StrEnum):
    """角色朝向——多方向扩展时使用。"""

    FRONT = "front"
    SIDE = "side"
    BACK = "back"
    LEFT = "left"


# -- 工作流 ---------------------------------------------------------------


@dataclass
class Workflow:
    """工作流——一个画布实例。"""

    id: int | None = None
    user_id: int = 0
    project_id: int | None = None
    name: str = "未命名工作流"
    status: WorkflowStatus = WorkflowStatus.ACTIVE
    project_context: dict = field(default_factory=dict)
    schema_version: int = 1
    version: int = 1
    create_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    update_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))


# -- 画布卡片 -------------------------------------------------------------


@dataclass
class CanvasCard:
    """画布卡片——工作流节点。

    user_input / latest_result 结构按 card_type 不同，见 schema.py 中的注释。
    """

    id: int | None = None
    workflow_id: int = 0
    card_type: CardType = CardType.CHARACTER
    status: CardStatus = CardStatus.DRAFT
    parent_card_id: int | None = None
    direction: Direction | None = None
    position_x: float = 0.0
    position_y: float = 0.0
    user_input: dict = field(default_factory=dict)
    latest_result: dict | None = None
    spec_overrides: dict = field(default_factory=dict)
    is_active: bool = True
    version: int = 1
    create_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    update_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))

    @property
    def is_terminal(self) -> bool:
        return self.status in (CardStatus.COMPLETED, CardStatus.FAILED, CardStatus.INACTIVE)


# -- 生成尝试 -------------------------------------------------------------


@dataclass
class GenerationAttempt:
    """生成尝试——每次触发生成创建一条记录。"""

    id: int | None = None
    card_id: int = 0
    task_id: int | None = None
    attempt_no: int = 1
    status: AttemptStatus = AttemptStatus.PENDING
    input_payload: dict = field(default_factory=dict)
    result: dict | None = None
    error_message: str | None = None
    create_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    update_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))

    @property
    def is_terminal(self) -> bool:
        return self.status in (AttemptStatus.COMPLETED, AttemptStatus.FAILED)
