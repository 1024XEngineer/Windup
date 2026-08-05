"""工作流执行记录 API。

契约层：定义端点和请求/响应模型，与 server 层解耦。
实际逻辑由 server 层实现，本文件只做参数校验和格式转换。

端点一览
--------
POST   /workflow-runs                                  创建执行记录
GET    /workflow-runs/{id}                              获取执行记录详情
GET    /workflow-runs/{id}/tree                         获取执行记录树（含全部节点）
DELETE /workflow-runs/{id}                              软删除执行记录
POST   /workflow-runs/{id}/nodes                       记录一个执行步骤
PATCH  /workflow-runs/{id}/nodes/{node_id}             更新节点状态/结果
POST   /workflow-runs/{id}/rollback/{node_id}          回滚到指定节点
POST   /workflow-runs/{id}/diff/{old_run_id}           对比新旧 run
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from windup_common.result import Response
from windup_framework.db import get_session

from windup_app.server.workflow_run.schema import (
    DiffResultOut,
    NodeCreateRequest,
    NodeUpdateRequest,
    WorkflowRunCreateRequest,
    WorkflowRunNodeOut,
    WorkflowRunOut,
    WorkflowRunTreeOut,
)

logger = logging.getLogger("windup.workflow_run.api")

router = APIRouter(prefix="/workflow-runs", tags=["workflow-run"])


# ── 执行记录 CRUD ───────────────────────────────────────────────────────────


@router.post("", response_model=Response[WorkflowRunOut])
def create_run(
    body: WorkflowRunCreateRequest,
    session: Session = Depends(get_session),
) -> Response[WorkflowRunOut]:
    """创建执行记录。

    修改角色模板时传 parent_run_id，形成版本链。
    """
    # TODO: service.create_run
    raise NotImplementedError


@router.get("/{run_id}", response_model=Response[WorkflowRunOut])
def get_run(
    run_id: int,
    session: Session = Depends(get_session),
) -> Response[WorkflowRunOut]:
    """获取执行记录详情（不含节点树）。"""
    # TODO: service.get_run
    raise NotImplementedError


@router.get("/{run_id}/tree", response_model=Response[WorkflowRunTreeOut])
def get_run_tree(
    run_id: int,
    session: Session = Depends(get_session),
) -> Response[WorkflowRunTreeOut]:
    """获取执行记录及其全部节点。

    前端根据 parent_node_id 组装树形结构。
    """
    # TODO: service.get_run_tree
    raise NotImplementedError


@router.delete("/{run_id}", response_model=Response[None])
def delete_run(
    run_id: int,
    session: Session = Depends(get_session),
) -> Response[None]:
    """软删除执行记录。"""
    # TODO: service.delete_run
    raise NotImplementedError


# ── 节点操作 ────────────────────────────────────────────────────────────────


@router.post("/{run_id}/nodes", response_model=Response[WorkflowRunNodeOut])
def create_node(
    run_id: int,
    body: NodeCreateRequest,
    session: Session = Depends(get_session),
) -> Response[WorkflowRunNodeOut]:
    """记录一个执行步骤。

    前端提交原子能力调用后，通过此端点记录步骤。
    task_id 用于关联 SSE 进度订阅。
    """
    # TODO: service.create_node
    raise NotImplementedError


@router.patch("/{run_id}/nodes/{node_id}", response_model=Response[WorkflowRunNodeOut])
def update_node(
    run_id: int,
    node_id: int,
    body: NodeUpdateRequest,
    session: Session = Depends(get_session),
) -> Response[WorkflowRunNodeOut]:
    """更新节点状态和/或输出。

    前端收到 SSE completed 事件后，通过此端点更新节点结果。
    """
    # TODO: service.update_node
    raise NotImplementedError


@router.post("/{run_id}/rollback/{node_id}", response_model=Response[WorkflowRunOut])
def rollback_to_node(
    run_id: int,
    node_id: int,
    session: Session = Depends(get_session),
) -> Response[WorkflowRunOut]:
    """回滚到指定节点——标记该节点及其下游为 rolled_back。"""
    # TODO: service.rollback_to_node
    raise NotImplementedError


@router.post("/{run_id}/diff/{old_run_id}", response_model=Response[DiffResultOut])
def diff_runs(
    run_id: int,
    old_run_id: int,
    session: Session = Depends(get_session),
) -> Response[DiffResultOut]:
    """对比新旧 run，返回可复用节点和需要重新执行的能力。"""
    # TODO: service.diff_runs
    raise NotImplementedError
