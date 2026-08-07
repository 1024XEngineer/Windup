"""工作流执行记录领域服务接口。

API 层只依赖本模块定义的抽象。具体实现在应用装配层继承后通过依赖注入提供。

职责
----
- 存储执行记录（含前端维护的节点树 JSONB）
- 支持版本管理（修改角色模板 → 新版本 run）

不做
----
- 不感知节点结构（前端自定义 nodes JSONB 内容）
- 不管节点拼装和推进（由前端负责）
- 不执行业务逻辑（由原子能力 API 负责）
"""

from __future__ import annotations

from abc import ABC, abstractmethod

from windup_app.server.workflow_run.model import (
    RunStatus,
    WorkflowRun,
)


class WorkflowRunService(ABC):
    """执行记录用例的抽象边界。"""

    # -- 执行记录 CRUD --------------------------------------------------------

    @abstractmethod
    def create_run(
        self,
        *,
        project_id: int,
        nodes: list | None = None,
    ) -> WorkflowRun:
        """创建执行记录。

        nodes 为前端定义的初始节点树（可选）。
        """

    @abstractmethod
    def get_run(self, run_id: int) -> WorkflowRun | None:
        """获取执行记录详情（含 nodes JSONB）。"""

    @abstractmethod
    def update_run(
        self,
        run_id: int,
        *,
        nodes: list | None = None,
        status: RunStatus | None = None,
    ) -> WorkflowRun:
        """全量更新执行记录。

        前端维护节点树后，通过此接口全量写回。
        """

    @abstractmethod
    def delete_run(self, run_id: int) -> None:
        """软删除执行记录。"""
