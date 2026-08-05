"""工作流执行记录领域模型。

后端不感知节点结构，节点树由前端维护，
通过 workflow_run.nodes JSONB 字段全量读写。
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


# -- 执行记录 -------------------------------------------------------------


@dataclass
class WorkflowRun:
    """执行记录——一个角色的完整生命周期。

    修改角色模板时，创建新 run（parent_run_id 指向旧 run），形成版本链。
    nodes 字段存储前端定义的节点树结构，后端不校验其内容。
    """

    id: int | None = None
    project_id: int = 0
    parent_run_id: int | None = None
    root_capability: str = ""           # 根节点能力类型（如 "generate_images"）
    root_input: dict = field(default_factory=dict)
    root_output: dict | None = None
    nodes: list = field(default_factory=list)   # 节点树（前端自定义结构）
    status: RunStatus = RunStatus.ACTIVE
    version: int = 1
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
