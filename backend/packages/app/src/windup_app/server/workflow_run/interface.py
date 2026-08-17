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

from sqlalchemy.orm import Session

from windup_app.server.workflow_run.model import RunStatus, WorkflowRun


class WorkflowRunService(ABC):
    """执行记录用例的抽象边界。"""

    @abstractmethod
    def create_run(
        self,
        session: Session,
        *,
        project_id: int,
        nodes: list | None = None,
    ) -> WorkflowRun:
        """创建执行记录。

        nodes 为前端定义的初始节点树（可选）。
        """

    @abstractmethod
    def get_run(self, session: Session, run_id: int) -> WorkflowRun | None:
        """获取执行记录详情（含 nodes JSONB）。"""

    @abstractmethod
    def list_runs(
        self,
        session: Session,
        *,
        project_id: int,
        page: int = 1,
        page_size: int = 20,
    ) -> tuple[list[WorkflowRun], int]:
        """分页查询项目下的执行记录，返回 (当前页数据, 总数)。"""

    @abstractmethod
    def update_run(
        self,
        session: Session,
        run_id: int,
        *,
        expected_version: int,
        nodes: list | None = None,
        status: RunStatus | None = None,
    ) -> WorkflowRun | None:
        """更新执行记录。

        前端维护节点树后，通过此接口全量写回。
        ``expected_version`` 必须等于库中当前版本，否则乐观锁冲突。
        无字段变更时不递增 version，但仍校验版本。
        只写入请求明确提供且确有变化的列。
        返回更新后的记录；不存在时返回 None。
        """

    @abstractmethod
    def delete_run(self, session: Session, run_id: int) -> bool:
        """软删除执行记录。命中时递增 version，与 PATCH 共用乐观锁。返回是否找到。"""
