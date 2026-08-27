"""工作流执行记录 API。

端点一览
--------
POST   /workflow-runs                     创建执行记录
GET    /workflow-runs?project_id=...      分页列表
GET    /workflow-runs/{id}                获取执行记录（含 nodes）
GET    /workflow-runs/{id}/agent-conversation  获取 Quick Start 对话
PUT    /workflow-runs/{id}/agent-conversation  保存 Quick Start 对话
PATCH  /workflow-runs/{id}                全量更新（含 nodes）
DELETE /workflow-runs/{id}                软删除

设计原则
--------
后端只做存储，不感知节点结构。
nodes 字段由前端自定义，后端只做全量读写，不校验 nodes 内部结构。
"""

from __future__ import annotations

import json
import logging
from datetime import datetime
from typing import Any, Literal

from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from sqlalchemy.orm import Session

from windup_common.enums.biz_code import BizCode
from windup_common.exceptions import BizException
from windup_common.result import ListResponse, Response
from windup_framework.db import get_session

from windup_app.server.project.model import Project
from windup_app.server.quick_start_conversation.model import QuickStartAgentConversation
from windup_app.server.quick_start_conversation.service import (
    service as conversation_service,
)
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
    created_at: datetime


class AgentConversationTurn(BaseModel):
    """服务端只约束稳定外壳，proposal 等扩展字段保持前端原样。"""

    model_config = ConfigDict(extra="allow")

    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=8_000)

    @field_validator("content")
    @classmethod
    def content_must_not_be_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("content 不能为空")
        return value


class AgentConversationUpdate(BaseModel):
    """完整替换一条运行记录的 Agent 对话。"""

    version: int = Field(ge=0)
    schema_version: Literal[2] = 2
    turns: list[AgentConversationTurn] = Field(max_length=256)

    @model_validator(mode="after")
    def payload_must_fit_snapshot_limit(self):
        payload = [
            turn.model_dump(mode="json", exclude_none=True) for turn in self.turns
        ]
        encoded = json.dumps(
            payload, ensure_ascii=False, separators=(",", ":")
        ).encode()
        if len(encoded) > 256 * 1_024:
            raise ValueError("Agent 对话快照不能超过 256 KiB")
        return self


class AgentConversationOut(BaseModel):
    """Quick Start Agent 对话快照响应。"""

    run_id: int
    turns: list[dict[str, Any]]
    schema_version: int
    version: int
    updated_at: datetime | None


def _conversation_out(
    run_id: int,
    conversation: QuickStartAgentConversation | None,
) -> AgentConversationOut:
    if conversation is None:
        return AgentConversationOut(
            run_id=run_id,
            turns=[],
            schema_version=2,
            version=0,
            updated_at=None,
        )
    return AgentConversationOut(
        run_id=run_id,
        turns=conversation.turns,
        schema_version=conversation.schema_version,
        version=conversation.version,
        updated_at=conversation.updated_at,
    )


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
    project_id: int | None = Query(None, gt=0),
    request: Request = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    session: Session = Depends(get_session),
) -> ListResponse[WorkflowRunOut]:
    """分页查询项目记录；未指定项目时返回当前用户的跨项目历史。"""
    user_id = request.state.current_user.id
    if project_id is None:
        items, total = service.list_user_runs(
            session, user_id=user_id, page=page, page_size=page_size,
        )
    else:
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


@router.get(
    "/{run_id}/agent-conversation",
    response_model=Response[AgentConversationOut],
)
def get_agent_conversation(
    run_id: int,
    request: Request,
    session: Session = Depends(get_session),
) -> Response[AgentConversationOut]:
    """读取运行记录的 Agent 对话；尚未保存时返回空快照。"""
    user_id = request.state.current_user.id
    _get_run_with_auth(session, run_id, user_id)
    conversation = conversation_service.get(session, run_id)
    return Response.success(_conversation_out(run_id, conversation))


@router.put(
    "/{run_id}/agent-conversation",
    response_model=Response[AgentConversationOut],
)
def save_agent_conversation(
    run_id: int,
    body: AgentConversationUpdate,
    request: Request,
    session: Session = Depends(get_session),
) -> Response[AgentConversationOut]:
    """以独立乐观锁保存完整 Agent 对话，不修改 WorkflowRun 版本。"""
    user_id = request.state.current_user.id
    _get_run_with_auth(session, run_id, user_id)
    turns = [turn.model_dump(mode="json", exclude_none=True) for turn in body.turns]
    conversation = conversation_service.save(
        session,
        run_id,
        expected_version=body.version,
        schema_version=body.schema_version,
        turns=turns,
    )
    return Response.success(_conversation_out(run_id, conversation), message="保存成功")


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
