"""工作流画布 API。

契约层：定义端点和请求/响应模型，与 server 层解耦。
实际逻辑由 server 层实现，本文件只做参数校验和格式转换。

端点一览
--------
POST   /workflow                                  创建工作流
GET    /workflow/{id}                              获取工作流详情
DELETE /workflow/{id}                              删除工作流
POST   /workflow/{wf_id}/cards                     创建子卡片
PATCH  /workflow/{wf_id}/cards/{card_id}           更新卡片
POST   /workflow/{wf_id}/cards/{card_id}/confirm   确认卡片（触发生成）
POST   /workflow/{wf_id}/cards/{card_id}/regenerate 重新生成
DELETE /workflow/{wf_id}/cards/{card_id}           删除卡片
GET    /workflow/{wf_id}/cards/{card_id}/attempts  获取生成尝试历史
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from windup_common.result import Response, ListResponse
from windup_framework.db import get_session

from windup_app.server.workflow.schema import (
    CanvasCardOut,
    CardConfirmRequest,
    CardCreateRequest,
    CardRegenerateRequest,
    CardUpdateRequest,
    GenerationAttemptOut,
    WorkflowCreateRequest,
    WorkflowOut,
)

logger = logging.getLogger("windup.workflow.api")

router = APIRouter(prefix="/workflow", tags=["workflow"])


# ── 工作流 CRUD ─────────────────────────────────────────────────────────────


@router.post("", response_model=Response[WorkflowOut])
def create_workflow(
    body: WorkflowCreateRequest,
    session: Session = Depends(get_session),
) -> Response[WorkflowOut]:
    """创建工作流。

    自动创建一张 CHARACTER 根卡片作为画布起点。
    返回的工作流已包含该卡片。
    """
    # TODO: service.create_workflow
    raise NotImplementedError


@router.get("/{workflow_id}", response_model=Response[WorkflowOut])
def get_workflow(
    workflow_id: int,
    session: Session = Depends(get_session),
) -> Response[WorkflowOut]:
    """获取工作流详情（含全部 active 卡片）。

    前端进入画布时调用，获取完整的卡片树。
    """
    # TODO: service.get_workflow
    raise NotImplementedError


@router.delete("/{workflow_id}", response_model=Response[None])
def delete_workflow(
    workflow_id: int,
    session: Session = Depends(get_session),
) -> Response[None]:
    """删除工作流（级联软删除所有卡片）。"""
    # TODO: service.delete_workflow
    raise NotImplementedError


# ── 卡片操作 ────────────────────────────────────────────────────────────────


@router.post("/{workflow_id}/cards", response_model=Response[CanvasCardOut])
def create_card(
    workflow_id: int,
    body: CardCreateRequest,
    session: Session = Depends(get_session),
) -> Response[CanvasCardOut]:
    """创建子卡片（ACTION / EXPORT）。

    由前端"+"菜单触发。ACTION 卡片创建时自动复制母版图。
    """
    # TODO: card_service.create_card
    raise NotImplementedError


@router.patch("/{workflow_id}/cards/{card_id}", response_model=Response[CanvasCardOut])
def update_card(
    workflow_id: int,
    card_id: int,
    body: CardUpdateRequest,
    session: Session = Depends(get_session),
) -> Response[CanvasCardOut]:
    """更新卡片用户输入或位置（不触发生成）。

    用于保存草稿、拖动画布位置等场景。
    """
    # TODO: card_service.update_card
    raise NotImplementedError


@router.post("/{workflow_id}/cards/{card_id}/confirm", response_model=Response[GenerationAttemptOut])
def confirm_card(
    workflow_id: int,
    card_id: int,
    body: CardConfirmRequest,
    session: Session = Depends(get_session),
) -> Response[GenerationAttemptOut]:
    """确认卡片，触发生成。

    - CHARACTER：生成候选图 → 自动创建 CANDIDATE 卡片。
    - ACTION：生成动画帧。
    - EXPORT：打包导出。

    返回的 GenerationAttempt 包含 task_id，前端应订阅 Task SSE 获取进度：
    ``GET /generation/tasks/{task_id}/stream``
    """
    # TODO: card_service.confirm_card
    raise NotImplementedError


@router.post("/{workflow_id}/cards/{card_id}/regenerate", response_model=Response[GenerationAttemptOut])
def regenerate_card(
    workflow_id: int,
    card_id: int,
    body: CardRegenerateRequest,
    session: Session = Depends(get_session),
) -> Response[GenerationAttemptOut]:
    """重新生成（创建新的 GenerationAttempt）。

    - CHARACTER：旧 CANDIDATE 全部 INACTIVE，重新生成候选。ACTION/EXPORT 不受影响。
    - ACTION / EXPORT：创建新 attempt，重新执行。
    """
    # TODO: card_service.regenerate_card
    raise NotImplementedError


@router.delete("/{workflow_id}/cards/{card_id}", response_model=Response[None])
def delete_card(
    workflow_id: int,
    card_id: int,
    session: Session = Depends(get_session),
) -> Response[None]:
    """删除卡片（级联软删除所有子卡片）。

    删除 CHARACTER 会级联删除其下的 CANDIDATE、ACTION、EXPORT。
    """
    # TODO: card_service.delete_card
    raise NotImplementedError


@router.get("/{workflow_id}/cards/{card_id}/attempts", response_model=ListResponse[GenerationAttemptOut])
def get_attempts(
    workflow_id: int,
    card_id: int,
    session: Session = Depends(get_session),
) -> ListResponse[GenerationAttemptOut]:
    """获取某张卡片的全部生成尝试记录。

    用于展示历史生成结果、调试等。
    """
    # TODO: card_service.get_attempts
    raise NotImplementedError
