"""工作流执行记录 API Schema。

定义前端请求/响应的 Pydantic 模型，与 server 层解耦。
前端团队参考此文件了解接口契约。

后端只做存储，不感知 nodes 字段的内部结构，前端自定义。
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field


# ══════════════════════════════════════════════════════════════════════════════
# 执行记录
# ══════════════════════════════════════════════════════════════════════════════


class WorkflowRunCreateRequest(BaseModel):
    """创建执行记录。"""

    project_id: int = Field(description="关联项目 ID")
    nodes: list = Field(
        default_factory=list,
        description="节点树（前端自定义结构，后端不校验）",
    )


class WorkflowRunUpdateRequest(BaseModel):
    """全量更新执行记录。

    前端维护节点树后，通过此接口全量写回。
    ``version`` 必须等于当前记录版本，否则乐观锁冲突。
    """

    version: int = Field(ge=1, description="客户端读到的当前版本号")
    nodes: list | None = Field(
        default=None,
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
    nodes: list = Field(default_factory=list, description="节点树（前端自定义结构）")
    status: str = Field(description="active / soft_deleted")
    version: int = Field(description="乐观锁版本号，从 1 递增")
