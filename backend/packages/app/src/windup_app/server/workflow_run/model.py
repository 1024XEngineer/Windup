"""工作流执行记录领域模型。

后端只做存储，不感知节点结构。
节点树由前端维护，通过 workflow_run.nodes JSONB 字段全量读写。
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
    """执行记录——前端维护的节点树的持久化容器。

    后端不校验 nodes 内部结构，仅做全量读写。
    """

    id: int | None = None
    project_id: int = 0
    nodes: list = field(default_factory=list)   # 节点树（前端自定义结构，后端不校验）
    status: RunStatus = RunStatus.ACTIVE
    version: int = 1
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
