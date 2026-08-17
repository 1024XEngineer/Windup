"""进程重启后对账：有冻结、未终态的生成任务重新入队或失败解冻。

调度本身仍是进程内 ThreadPoolExecutor。队列项会随进程消失，但任务行和
FROZEN 流水在库里。启动时扫描 PENDING/RUNNING 且仍有开放冻结的任务：

- PENDING：按落库的 ``input_payload`` 再入队（生成尚未开始）
- RUNNING：视为执行中被打断，标 FAILED 并解冻（避免重复打上游）
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from typing import Any

from sqlalchemy.orm import Session

from windup_app.server.orchestrator import billing, task_repo
from windup_app.server.orchestrator.model import (
    ActionType,
    CharacterActionInput,
    CharacterImageInput,
    GenerationTask,
    GenerationType,
    TaskStatus,
)

logger = logging.getLogger("windup.generation.recover")


def recover_orphaned_generation_tasks(
    session: Session,
    *,
    dispatcher: Any,
    run_image_task: Callable[..., Any],
    run_action_task: Callable[..., Any],
) -> None:
    """扫描未结清冻结的开放任务并恢复。调用方负责 commit。"""
    for task in task_repo.list_by_status(
        session, (TaskStatus.PENDING, TaskStatus.RUNNING),
    ):
        if task.id is None or not billing.has_open_freeze(session, task.id):
            continue
        if task.status is TaskStatus.RUNNING:
            _fail_interrupted(session, task)
            continue
        _requeue_pending(session, dispatcher, run_image_task, run_action_task, task)


def _fail_interrupted(session: Session, task: GenerationTask) -> None:
    assert task.id is not None
    task_repo.update_status(
        session, task.id, TaskStatus.FAILED,
        error_message="进程中断，已解冻积分",
    )
    billing.release_for_task(session, user_id=task.user_id, task_id=task.id)
    logger.warning("孤儿 RUNNING 任务已失败解冻 | task_id=%s", task.id)


def _requeue_pending(
    session: Session,
    dispatcher: Any,
    run_image_task: Callable[..., Any],
    run_action_task: Callable[..., Any],
    task: GenerationTask,
) -> None:
    assert task.id is not None
    payload = task.input_payload or {}
    try:
        if task.task_type is GenerationType.CHARACTER_IMAGE:
            dispatcher.submit(
                run_image_task, task.id, _image_input(payload), task.project_id,
            )
        elif task.task_type is GenerationType.CHARACTER_ACTION:
            dispatcher.submit(
                run_action_task, task.id, _action_input(payload), task.project_id,
            )
        else:
            raise ValueError(f"未知任务类型: {task.task_type}")
    except Exception:
        logger.exception("PENDING 任务重入队失败，改为解冻 | task_id=%s", task.id)
        _fail_interrupted(session, task)
        return
    logger.info("孤儿 PENDING 任务已重入队 | task_id=%s", task.id)


def _image_input(payload: dict) -> CharacterImageInput:
    return CharacterImageInput(
        reference_image_url=payload.get("reference_image_url"),
        prompt=payload.get("prompt") or "",
        negative_prompt=payload.get("negative_prompt") or "",
        width=int(payload.get("width") or 1024),
        height=int(payload.get("height") or 1024),
        num_images=int(payload.get("num_images") or 1),
    )


def _action_input(payload: dict) -> CharacterActionInput:
    raw_type = payload.get("action_type")
    action_type = raw_type if isinstance(raw_type, ActionType) else ActionType(raw_type)
    return CharacterActionInput(
        character_id=int(payload["character_id"]),
        action_type=action_type,
        custom_prompt=payload.get("custom_prompt"),
        reference_video_url=payload.get("reference_video_url"),
        reference_image_urls=list(payload.get("reference_image_urls") or []),
        num_frames=int(payload.get("num_frames") or 16),
        loop=payload.get("loop"),
        video_model=payload.get("video_model"),
    )
