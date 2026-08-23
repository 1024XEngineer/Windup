"""Worker 侧 handler 实现。"""

from __future__ import annotations

import logging
import time
from collections.abc import Callable
from typing import Any

from windup_app.server.mq.catalog import (
    EMAIL_HANDLER_RETRIES,
    MSG_TYPE_CHARACTER_ACTION,
    MSG_TYPE_CHARACTER_IMAGE,
    MSG_TYPE_VERIFICATION_CODE,
)
from windup_app.server.orchestrator import billing, task_repo
from windup_app.server.orchestrator.model import (
    ActionType,
    CharacterActionInput,
    CharacterImageInput,
    GenerationType,
    TaskStatus,
)
from windup_common.directions import ActionDirection
from windup_app.server.user.service import VERIFY_CODE_KEY
from windup_framework.db.redis import get_redis
from windup_framework.db.session import SessionLocal
from windup_framework.providers.email import email_provider

logger = logging.getLogger("windup.worker.handlers")


class HandlerDeferred(Exception):
    """任务仍在执行中，消息应留 PEL 稍后重试，不可 ACK。"""


def handle_verification_code(payload: dict[str, Any]) -> None:
    email = str(payload["email"])
    purpose = str(payload["purpose"])
    code_key = VERIFY_CODE_KEY.format(purpose=purpose, email=email)
    code = get_redis().get(code_key)
    if not code:
        logger.info("验证码已过期或不存在，跳过发送 | email=%s purpose=%s", email, purpose)
        return

    last_error: Exception | None = None
    for attempt in range(1, EMAIL_HANDLER_RETRIES + 1):
        try:
            email_provider.send_verification_code(email, code)
            logger.info("验证码邮件已发送 | email=%s purpose=%s", email, purpose)
            return
        except Exception as exc:
            last_error = exc
            logger.warning(
                "验证码邮件发送失败，重试 %d/%d | email=%s",
                attempt,
                EMAIL_HANDLER_RETRIES,
                email,
            )
            time.sleep(min(attempt, 3))
    raise last_error or RuntimeError("验证码邮件发送失败")


def _image_input(payload: dict) -> CharacterImageInput:
    return CharacterImageInput(
        reference_image_url=payload.get("reference_image_url"),
        prompt=payload.get("prompt") or "",
        negative_prompt=payload.get("negative_prompt") or "",
        width=int(payload.get("width") or 1024),
        height=int(payload.get("height") or 1024),
        num_images=int(payload.get("num_images") or 1),
        direction=ActionDirection(payload.get("direction") or ActionDirection.EAST.value),
    )


def _action_input(payload: dict) -> CharacterActionInput:
    raw_type = payload.get("action_type")
    action_type = raw_type if isinstance(raw_type, ActionType) else ActionType(raw_type)
    # 帧数缺失时原样传 None,交给入参按动作类型解析:在这里兜一个数就是第二份约定,
    # 它与真正的约定分叉时任务照跑、帧数照出,没有一处会红。
    raw_frames = payload.get("num_frames")
    return CharacterActionInput(
        character_id=int(payload["character_id"]),
        action_type=action_type,
        custom_prompt=payload.get("custom_prompt"),
        reference_video_url=payload.get("reference_video_url"),
        reference_image_urls=list(payload.get("reference_image_urls") or []),
        num_frames=int(raw_frames) if raw_frames is not None else None,
        loop=payload.get("loop"),
        ground_contact=payload.get("ground_contact"),
        video_model=payload.get("video_model"),
        outfit_id=payload.get("outfit_id"),
        model_3d_url=payload.get("model_3d_url"),
        direction=ActionDirection(payload.get("direction") or ActionDirection.EAST.value),
    )


def handle_generation(
    payload: dict[str, Any],
    *,
    run_image_task: Callable[..., Any],
    run_action_task: Callable[..., Any],
) -> None:
    task_id = int(payload["task_id"])
    task_type = str(payload.get("task_type") or "")

    session = SessionLocal()
    try:
        task = task_repo.get_task(session, task_id)
        if task is None:
            logger.warning("生成任务不存在 | task_id=%d", task_id)
            return
        if task.status in (TaskStatus.COMPLETED, TaskStatus.FAILED):
            logger.info("任务已终态，跳过执行 | task_id=%d status=%s", task_id, task.status)
            return
        if task.status is TaskStatus.RUNNING:
            logger.info("任务 RUNNING 中，延后重试 | task_id=%d", task_id)
            raise HandlerDeferred(f"task {task_id} still running")
        if not billing.has_open_freeze(session, task_id):
            logger.warning("任务无开放冻结，跳过 | task_id=%d", task_id)
            return

        input_payload = task.input_payload or {}
        project_id = task.project_id
    finally:
        session.close()

    if task_type == GenerationType.CHARACTER_IMAGE.value:
        run_image_task(task_id, _image_input(input_payload), project_id)
    elif task_type == GenerationType.CHARACTER_ACTION.value:
        run_action_task(task_id, _action_input(input_payload), project_id)
    else:
        raise ValueError(f"未知生成任务类型: {task_type}")


def dispatch_handler(
    msg_type: str,
    payload: dict[str, Any],
    *,
    run_image_task: Callable[..., Any],
    run_action_task: Callable[..., Any],
) -> None:
    if msg_type == MSG_TYPE_VERIFICATION_CODE:
        handle_verification_code(payload)
        return
    if msg_type in (MSG_TYPE_CHARACTER_IMAGE, MSG_TYPE_CHARACTER_ACTION):
        handle_generation(
            payload,
            run_image_task=run_image_task,
            run_action_task=run_action_task,
        )
        return
    raise ValueError(f"未知消息类型: {msg_type}")
