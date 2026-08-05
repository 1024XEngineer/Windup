"""工作流执行记录领域服务接口。

API 层只依赖本模块定义的抽象。具体实现在应用装配层继承后通过依赖注入提供。

职责
----
- 记录前端每一步的执行结果（哪个能力、什么输入、什么输出）
- 支持回滚到某个节点（标记下游为 rolled_back）
- 支持版本管理（修改角色模板 → 新版本 run）
- 支持跨树 diff（新旧 run 对比，识别可复用节点）

不做
----
- 不定义节点类型（由前端定义）
- 不管节点拼装和推进（由前端负责）
- 不执行业务逻辑（由原子能力 API 负责）
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field

from windup_app.server.workflow_run.model import (
    NodeStatus,
    WorkflowRun,
    WorkflowRunNode,
)


class WorkflowRunService(ABC):
    """执行记录用例的抽象边界。"""

    # -- 执行记录 CRUD --------------------------------------------------------

    @abstractmethod
    def create_run(
        self,
        *,
        project_id: int,
        parent_run_id: int | None = None,
        root_capability: str,
        root_input: dict | None = None,
    ) -> WorkflowRun:
        """创建执行记录。

        修改角色模板时传 parent_run_id，形成版本链。
        """

    @abstractmethod
    def get_run(self, run_id: int) -> WorkflowRun | None:
        """获取执行记录详情（不含节点树）。"""

    @abstractmethod
    def get_run_tree(self, run_id: int) -> tuple[WorkflowRun, list[WorkflowRunNode]] | None:
        """获取执行记录及其全部节点，按树形结构组装。"""

    @abstractmethod
    def delete_run(self, run_id: int) -> None:
        """软删除执行记录。"""

    # -- 节点操作 -------------------------------------------------------------

    @abstractmethod
    def create_node(
        self,
        run_id: int,
        *,
        parent_node_id: int | None = None,
        capability: str,
        input: dict | None = None,
        task_id: int | None = None,
        node_order: int = 0,
    ) -> WorkflowRunNode:
        """记录一个执行步骤。"""

    @abstractmethod
    def update_node(
        self,
        node_id: int,
        *,
        status: NodeStatus | None = None,
        output: dict | None = None,
    ) -> WorkflowRunNode:
        """更新节点状态和/或输出。"""

    @abstractmethod
    def rollback_to_node(self, run_id: int, node_id: int) -> WorkflowRun:
        """回滚到指定节点——标记该节点及其下游为 rolled_back。"""

    # -- Diff -----------------------------------------------------------------

    @abstractmethod
    def diff_runs(self, new_run_id: int, old_run_id: int) -> DiffResult:
        """对比新旧 run，返回可复用节点和需要重新执行的能力。"""


# -- Diff 结果模型 ---------------------------------------------------------


@dataclass
class ReusableNode:
    """可复用的节点信息。"""

    old_node_id: int
    capability: str
    input: dict


@dataclass
class NeedsRerun:
    """需要重新执行的能力。"""

    capability: str
    reason: str


@dataclass
class DiffResult:
    """跨 run diff 结果。"""

    reusable_nodes: list[ReusableNode] = field(default_factory=list)
    needs_rerun: list[NeedsRerun] = field(default_factory=list)
