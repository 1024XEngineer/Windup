"""工作流执行记录 API Schema。

定义前端请求/响应的 Pydantic 模型，与 server 层解耦。
前端团队参考此文件了解接口契约。

后端不定义节点类型，capability 字段由前端自定义。
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field


# ══════════════════════════════════════════════════════════════════════════════
# 执行记录
# ══════════════════════════════════════════════════════════════════════════════


class WorkflowRunCreateRequest(BaseModel):
    """创建执行记录。"""

    project_id: int = Field(description="关联项目 ID，项目约束从这里读取")
    parent_run_id: int | None = Field(
        default=None,
        description="父执行记录 ID（修改角色模板时指向旧 run，形成版本链）",
    )
    root_capability: str = Field(
        description="根节点能力类型（如 'generate_images'）",
    )
    root_input: dict = Field(
        default_factory=dict,
        description="根节点输入参数",
    )


class WorkflowRunOut(BaseModel):
    """执行记录响应。"""

    model_config = ConfigDict(from_attributes=True)

    id: int
    project_id: int
    parent_run_id: int | None = None
    root_capability: str = Field(description="根节点能力类型")
    root_input: dict = Field(default_factory=dict, description="根节点输入")
    root_output: dict | None = Field(default=None, description="根节点输出")
    status: str = Field(description="active / soft_deleted")
    version: int = Field(description="版本号，从 1 递增")


class WorkflowRunTreeOut(BaseModel):
    """执行记录树形结构响应（含全部节点）。"""

    model_config = ConfigDict(from_attributes=True)

    run: WorkflowRunOut
    nodes: list[WorkflowRunNodeOut] = Field(
        default_factory=list,
        description="全部节点，按创建顺序排列，前端根据 parent_node_id 组装树形结构",
    )


# ══════════════════════════════════════════════════════════════════════════════
# 执行节点
# ══════════════════════════════════════════════════════════════════════════════


class NodeCreateRequest(BaseModel):
    """记录一个执行步骤。"""

    parent_node_id: int | None = Field(
        default=None,
        description="父节点 ID（根节点为 null）",
    )
    capability: str = Field(
        description="原子能力名称（如 'generate_images'、'generate_frames'、'export'）",
    )
    input: dict = Field(
        default_factory=dict,
        description="该步骤的输入参数",
    )
    task_id: int | None = Field(
        default=None,
        description="关联的生成任务 ID（用于 SSE 进度订阅）",
    )
    node_order: int = Field(
        default=0,
        description="同级节点的执行顺序",
    )


class NodeUpdateRequest(BaseModel):
    """更新节点状态和/或输出。"""

    status: str | None = Field(
        default=None,
        description="新状态：pending / running / completed / failed / rolled_back",
    )
    output: dict | None = Field(
        default=None,
        description="该步骤的输出结果",
    )


class WorkflowRunNodeOut(BaseModel):
    """执行节点响应。"""

    model_config = ConfigDict(from_attributes=True)

    id: int
    run_id: int
    parent_node_id: int | None = None
    capability: str = Field(description="原子能力名称")
    input: dict = Field(default_factory=dict, description="输入参数")
    output: dict | None = Field(default=None, description="输出结果")
    status: str = Field(description="pending / running / completed / failed / rolled_back")
    task_id: int | None = Field(default=None, description="关联的生成任务 ID")
    node_order: int = Field(default=0, description="同级节点执行顺序")


# ══════════════════════════════════════════════════════════════════════════════
# Diff 结果
# ══════════════════════════════════════════════════════════════════════════════


class ReusableNodeOut(BaseModel):
    """可复用节点。"""

    old_node_id: int = Field(description="旧 run 中的节点 ID")
    capability: str = Field(description="能力名称")
    input: dict = Field(default_factory=dict, description="输入参数")


class NeedsRerunOut(BaseModel):
    """需要重新执行的能力。"""

    capability: str = Field(description="能力名称")
    reason: str = Field(description="需要重新执行的原因")


class DiffResultOut(BaseModel):
    """跨 run diff 结果。"""

    reusable_nodes: list[ReusableNodeOut] = Field(
        default_factory=list,
        description="可复用的节点列表",
    )
    needs_rerun: list[NeedsRerunOut] = Field(
        default_factory=list,
        description="需要重新执行的能力列表",
    )
