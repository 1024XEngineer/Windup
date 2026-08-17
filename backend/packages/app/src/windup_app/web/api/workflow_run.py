"""工作流执行记录 API。

端点一览
--------
POST   /workflow-runs                     创建执行记录
GET    /workflow-runs?project_id=...      分页列表
GET    /workflow-runs/{id}                获取执行记录（含 nodes）
PATCH  /workflow-runs/{id}                全量更新（含 nodes）
DELETE /workflow-runs/{id}                软删除

设计原则
--------
后端只做存储，不感知节点结构。
nodes 字段由前端自定义，后端只做全量读写，不校验 nodes 内部结构。
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from windup_common.enums.biz_code import BizCode
from windup_common.exceptions import BizException
from windup_common.result import ListResponse, Response
from windup_framework.db import get_session

from windup_app.server.project.model import Project
from windup_app.server.workflow_run.model import RunStatus
from windup_app.server.workflow_run.service import service

logger = logging.getLogger("windup.workflow_run.api")

router = APIRouter(prefix="/workflow-runs", tags=["workflow-run"])


# ── 请求 / 响应模型 ─────────────────────────────────────────────────────────


class WorkflowRunCreate(BaseModel):
    """创建执行记录。"""

    project_id: int = Field(gt=0)
    nodes: list = Field(
        default_factory=list,
        description="节点树（前端自定义结构，后端不校验）",
    )


class WorkflowRunUpdate(BaseModel):
    """全量更新执行记录。"""

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
    nodes: list = Field(default_factory=list, description="节点树")
    status: str
    version: int


# ── 归属校验 ─────────────────────────────────────────────────────────────────


def _get_project_or_raise(
    session: Session, project_id: int, user_id: int,
) -> Project:
    """校验项目存在且属于当前用户。"""
    project = session.get(Project, project_id)
    if project is None or project.user_id != user_id:
        raise BizException("项目不存在", code=BizCode.NOT_FOUND)
    return project


def _get_run_with_auth(
    session: Session, run_id: int, user_id: int,
):
    """获取执行记录并校验其所属项目属于当前用户。"""
    run = service.get_run(session, run_id)
    if run is None:
        raise BizException("执行记录不存在", code=BizCode.NOT_FOUND)
    project = session.get(Project, run.project_id)
    if project is None or project.user_id != user_id:
        raise BizException("执行记录不存在", code=BizCode.NOT_FOUND)
    return run


# ── 端点 ─────────────────────────────────────────────────────────────────────


@router.post("", response_model=Response[WorkflowRunOut])
def create_run(
    body: WorkflowRunCreate,
    request: Request,
    session: Session = Depends(get_session),
) -> Response[WorkflowRunOut]:
    """创建执行记录。"""
    user_id = request.state.current_user.id
    _get_project_or_raise(session, body.project_id, user_id)
    run = service.create_run(session, project_id=body.project_id, nodes=body.nodes)
    return Response.success(WorkflowRunOut.model_validate(run), message="创建成功")


@router.get("", response_model=ListResponse[WorkflowRunOut])
def list_runs(
    project_id: int = Query(..., gt=0),
    request: Request = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    session: Session = Depends(get_session),
) -> ListResponse[WorkflowRunOut]:
    """分页查询项目下的执行记录。"""
    user_id = request.state.current_user.id
    _get_project_or_raise(session, project_id, user_id)
    items, total = service.list_runs(
        session, project_id=project_id, page=page, page_size=page_size,
    )
    return ListResponse.success(
        [WorkflowRunOut.model_validate(r) for r in items],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.get("/{run_id}", response_model=Response[WorkflowRunOut])
def get_run(
    run_id: int,
    request: Request,
    session: Session = Depends(get_session),
) -> Response[WorkflowRunOut]:
    """获取执行记录详情（含 nodes JSONB）。"""
    user_id = request.state.current_user.id
    run = _get_run_with_auth(session, run_id, user_id)
    return Response.success(WorkflowRunOut.model_validate(run))


@router.patch("/{run_id}", response_model=Response[WorkflowRunOut])
def update_run(
    run_id: int,
    body: WorkflowRunUpdate,
    request: Request,
    session: Session = Depends(get_session),
) -> Response[WorkflowRunOut]:
    """全量更新执行记录。"""
    user_id = request.state.current_user.id
    _get_run_with_auth(session, run_id, user_id)

    status = None
    if body.status is not None:
        try:
            status = RunStatus(body.status)
        except ValueError:
            raise BizException(
                f"无效状态: {body.status}，可选: active / soft_deleted",
                code=BizCode.BAD_REQUEST,
            ) from None

    run = service.update_run(
        session,
        run_id,
        expected_version=body.version,
        nodes=body.nodes,
        status=status,
    )
    return Response.success(WorkflowRunOut.model_validate(run), message="更新成功")


@router.delete("/{run_id}", response_model=Response[None])
def delete_run(
    run_id: int,
    request: Request,
    session: Session = Depends(get_session),
) -> Response[None]:
    """软删除执行记录。"""
    user_id = request.state.current_user.id
    _get_run_with_auth(session, run_id, user_id)
    service.delete_run(session, run_id)
    return Response.success(None, message="删除成功")
