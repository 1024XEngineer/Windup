"""工作流执行记录 API。

契约层：定义端点和请求/响应模型，与 server 层解耦。
实际逻辑由 server 层实现，本文件只做参数校验和格式转换。

端点一览
--------
POST   /workflow-runs                     创建执行记录
GET    /workflow-runs/{id}                 获取执行记录（含 nodes）
PATCH  /workflow-runs/{id}                 全量更新（含 nodes）
DELETE /workflow-runs/{id}                 软删除

设计原则
--------
后端只做存储，不感知节点结构。
nodes 字段由前端自定义，后端只做全量读写，不校验 nodes 内部结构。
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from windup_common.result import Response
from windup_framework.db import get_session

from windup_app.server.workflow_run.schema import (
    WorkflowRunCreateRequest,
    WorkflowRunOut,
    WorkflowRunUpdateRequest,
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

    nodes 为前端定义的初始节点树（可选）。
    """
    # TODO: service.create_run
    raise NotImplementedError


@router.get("/{run_id}", response_model=Response[WorkflowRunOut])
def get_run(
    run_id: int,
    session: Session = Depends(get_session),
) -> Response[WorkflowRunOut]:
    """获取执行记录详情（含 nodes JSONB）。"""
    # TODO: service.get_run
    raise NotImplementedError


@router.patch("/{run_id}", response_model=Response[WorkflowRunOut])
def update_run(
    run_id: int,
    body: WorkflowRunUpdateRequest,
    session: Session = Depends(get_session),
) -> Response[WorkflowRunOut]:
    """全量更新执行记录。

    前端维护节点树后，通过此接口全量写回。
    后端不校验 nodes 内部结构。
    """
    # TODO: service.update_run
    raise NotImplementedError


@router.delete("/{run_id}", response_model=Response[None])
def delete_run(
    run_id: int,
    session: Session = Depends(get_session),
) -> Response[None]:
    """软删除执行记录。"""
    # TODO: service.delete_run
    raise NotImplementedError
