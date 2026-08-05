"""工作流执行记录 API Schema。

定义前端请求/响应的 Pydantic 模型，与 server 层解耦。
前端团队参考此文件了解接口契约。

后端不感知 nodes 字段的内部结构，前端自定义。
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
    nodes: list = Field(
        default_factory=list,
        description="节点树（前端自定义结构，后端不校验）",
    )


class WorkflowRunUpdateRequest(BaseModel):
    """全量更新执行记录。

    前端维护节点树后，通过此接口全量写回。
    """

    root_output: dict | None = Field(
        default=None,
        description="根节点输出结果",
    )
    nodes: list = Field(
        default_factory=list,
        description="节点树（前端自定义结构，后端不校验）",
    )
    status: str | None = Field(
        default=None,
        description="状态：active / soft_deleted",
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
    nodes: list = Field(default_factory=list, description="节点树（前端自定义结构）")
    status: str = Field(description="active / soft_deleted")
    version: int = Field(description="版本号，从 1 递增")


# ══════════════════════════════════════════════════════════════════════════════
# Diff 结果
# ══════════════════════════════════════════════════════════════════════════════


class DiffResultOut(BaseModel):
    """跨 run diff 结果。"""

    old_nodes: list = Field(default_factory=list, description="旧 run 的节点树")
    new_nodes: list = Field(default_factory=list, description="新 run 的节点树")
    root_input_changed: bool = Field(description="根节点输入是否变化")
    root_capability_changed: bool = Field(description="根节点能力类型是否变化")
