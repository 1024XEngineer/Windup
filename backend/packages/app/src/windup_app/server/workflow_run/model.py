"""工作流执行记录领域模型。

树形执行记录体系：WorkflowRun（执行记录）→ WorkflowRunNode（执行节点）。
后端只做记录，不定义节点类型，节点的拼装和推进由前端负责。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import StrEnum


# -- 枚举 ----------------------------------------------------------------


class RunStatus(StrEnum):
    """执行记录状态。"""

    ACTIVE = "active"
    SOFT_DELETED = "soft_deleted"


class NodeStatus(StrEnum):
    """执行节点状态。"""

    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    ROLLED_BACK = "rolled_back"


# -- 执行记录 -------------------------------------------------------------


@dataclass
class WorkflowRun:
    """执行记录——一个角色的完整生命周期。

    修改角色模板时，创建新 run（parent_run_id 指向旧 run），形成版本链。
    """

    id: int | None = None
    project_id: int = 0
    parent_run_id: int | None = None
    root_capability: str = ""           # 根节点能力类型（如 "generate_images"）
    root_input: dict = field(default_factory=dict)
    root_output: dict | None = None
    status: RunStatus = RunStatus.ACTIVE
    version: int = 1
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))


# -- 执行节点 -------------------------------------------------------------


@dataclass
class WorkflowRunNode:
    """执行节点——树形结构中的一个步骤。

    capability 字段由前端定义（如 "generate_images"、"generate_frames"、"export"），
    后端不校验具体值，只负责记录。
    """

    id: int | None = None
    run_id: int = 0
    parent_node_id: int | None = None
    capability: str = ""                # 原子能力名称
    input: dict = field(default_factory=dict)
    output: dict | None = None
    status: NodeStatus = NodeStatus.PENDING
    task_id: int | None = None          # 关联的生成任务 ID（用于 SSE 进度订阅）
    node_order: int = 0                 # 同级节点的执行顺序
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))

    @property
    def is_terminal(self) -> bool:
        return self.status in (NodeStatus.COMPLETED, NodeStatus.FAILED, NodeStatus.ROLLED_BACK)
