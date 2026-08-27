"""Worker 侧 handler 实现。"""

from __future__ import annotations

import logging
import time
from collections.abc import Callable
from typing import Any

from windup_app.server.mq.catalog import (
    EMAIL_HANDLER_RETRIES,
    MSG_TYPE_CHARACTER_ACTION,
    MSG_TYPE_CHARACTER_ACTION_CLIENT_BAKE,
    MSG_TYPE_CHARACTER_ACTION_POLL,
    MSG_TYPE_CHARACTER_IMAGE,
    MSG_TYPE_VERIFICATION_CODE,
)
from windup_app.server.orchestrator import billing, task_repo
from windup_app.server.orchestrator.signals import ActionRateLimited
from windup_app.server.orchestrator.model import (
    ActionType,
    CharacterActionInput,
    CharacterDirectionSetInput,
    CharacterImageInput,
    CharacterViewSheetInput,
    GenerationType,
    TaskStatus,
)
from windup_app.server.user.service import VERIFY_CODE_KEY
from windup_common.directions import ActionDirection
from windup_common.models import CharacterStance
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
    # 张数缺失时原样传 None,交给入参自己的默认值:在这里兜一个数就是第二份约定,
    # 它与 CharacterImageInput 分叉时同一请求经不经过 MQ 出图张数不同,没有一处会红。
    raw_num_images = payload.get("num_images")
    return CharacterImageInput(
        reference_image_url=payload.get("reference_image_url"),
        prompt=payload.get("prompt") or "",
        negative_prompt=payload.get("negative_prompt") or "",
        width=int(payload.get("width") or 1024),
        height=int(payload.get("height") or 1024),
        num_images=int(raw_num_images) if raw_num_images is not None else None,
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
        stance=CharacterStance(payload["stance"]) if payload.get("stance") else None,
        direction=ActionDirection(payload.get("direction") or ActionDirection.EAST.value),
    )


def _direction_set_input(payload: dict) -> CharacterDirectionSetInput:
    raw_num_images = payload.get("num_images")
    raw_character_id = payload.get("character_id")
    raw_reference_image_url = payload.get("reference_image_url")
    raw_anchor_direction = payload.get("anchor_direction")
    return CharacterDirectionSetInput(
        character_id=int(raw_character_id) if raw_character_id is not None else None,
        reference_image_url=(
            str(raw_reference_image_url)
            if raw_reference_image_url is not None
            else None
        ),
        prompt=payload.get("prompt") or "",
        negative_prompt=payload.get("negative_prompt") or "",
        width=int(payload.get("width") or 1024),
        height=int(payload.get("height") or 1024),
        num_images=int(raw_num_images) if raw_num_images is not None else None,
        directions=[ActionDirection(value) for value in payload.get("directions") or []],
        anchor_direction=(
            ActionDirection(raw_anchor_direction)
            if raw_anchor_direction is not None
            else None
        ),
        billing_attempt=int(payload.get("billing_attempt") or 0),
    )


def _view_sheet_input(payload: dict) -> CharacterViewSheetInput:
    raw_num_images = payload.get("num_images")
    return CharacterViewSheetInput(
        character_id=int(payload["character_id"]),
        reference_image_url=str(payload.get("reference_image_url") or ""),
        prompt=payload.get("prompt") or "",
        negative_prompt=payload.get("negative_prompt") or "",
        width=int(payload.get("width") or 1024),
        height=int(payload.get("height") or 1024),
        num_images=int(raw_num_images) if raw_num_images is not None else None,
    )


def handle_generation(
    payload: dict[str, Any],
    *,
    run_image_task: Callable[..., Any],
    run_action_task: Callable[..., Any],
    run_direction_set_task: Callable[..., Any] | None = None,
    run_view_sheet_task: Callable[..., Any] | None = None,
) -> None:
    task_id = int(payload["task_id"])
    task_type = str(payload.get("task_type") or "")

    session = SessionLocal()
    try:
        task = task_repo.get_task(session, task_id)
        if task is None:
            logger.warning("生成任务不存在 | task_id=%d", task_id)
            return
        if task.is_terminal:
            logger.info("任务已终态，跳过执行 | task_id=%d status=%s", task_id, task.status)
            return
        if task.status is TaskStatus.RUNNING:
            logger.info("任务 RUNNING 中，延后重试 | task_id=%d", task_id)
            raise HandlerDeferred(f"task {task_id} still running")
        billing_attempt = billing.attempt_for_task(task.task_type, task.input_payload)
        if not billing.has_open_freeze(session, task_id, billing_attempt):
            logger.warning("任务无开放冻结，跳过 | task_id=%d", task_id)
            return

        input_payload = task.input_payload or {}
        project_id = task.project_id
    finally:
        session.close()

    if task_type == GenerationType.CHARACTER_IMAGE.value:
        run_image_task(task_id, _image_input(input_payload), project_id)
    elif task_type == GenerationType.CHARACTER_DIRECTION_SET.value:
        if run_direction_set_task is None:
            raise RuntimeError("未注入 run_direction_set_task")
        run_direction_set_task(task_id, _direction_set_input(input_payload), project_id)
    elif task_type in (
        GenerationType.CHARACTER_FOUR_VIEW.value,
        GenerationType.CHARACTER_EIGHT_VIEW.value,
    ):
        if run_view_sheet_task is None:
            raise RuntimeError("未注入 run_view_sheet_task")
        run_view_sheet_task(
            task_id,
            _view_sheet_input(input_payload),
            GenerationType(task_type),
            project_id,
        )
    elif task_type == GenerationType.CHARACTER_ACTION.value:
        try:
            run_action_task(task_id, _action_input(input_payload), project_id)
        except ActionRateLimited as exc:
            # 上游限流,而这次一分钱没花:让消息留在 PEL 稍后重认领,而不是判任务失败。
            # 翻成 HandlerDeferred 是因为重投的预算与节奏由消费层统一管
            # (MAX_CONSUME_ATTEMPTS × PEL_CLAIM_INTERVAL_SECONDS),在这里自己 sleep
            # 会把 action worker 占住,而限流期间恰恰是它最该去干别的活的时候。
            raise HandlerDeferred(f"task {task_id} rate limited upstream") from exc
    else:
        raise ValueError(f"未知生成任务类型: {task_type}")


def handle_action_poll(
    payload: dict[str, Any],
    *,
    resume_action_poll: Callable[..., Any],
) -> None:
    """RUNNING 是预期态:建单 worker 已 ACK,本消息只负责探一次。"""
    task_id = int(payload["task_id"])
    session = SessionLocal()
    try:
        task = task_repo.get_task(session, task_id)
        if task is None:
            logger.warning("轮询任务不存在 | task_id=%d", task_id)
            return
        if task.status in (TaskStatus.COMPLETED, TaskStatus.FAILED):
            logger.info("轮询任务已终态，跳过 | task_id=%d status=%s", task_id, task.status)
            return
        if not billing.has_open_freeze(session, task_id):
            logger.warning("轮询任务无开放冻结，跳过 | task_id=%d", task_id)
            return
        input_payload = task.input_payload or {}
        project_id = task.project_id
    finally:
        session.close()
    resume_action_poll(task_id, _action_input(input_payload), project_id)


def handle_action_client_bake(
    payload: dict[str, Any],
    *,
    resume_action_client_bake: Callable[..., Any],
) -> None:
    """浏览器交回帧 / 自报失败 / 到期未交,三种都从这里回到 worker。

    RUNNING 是预期态:建单 worker 早就 ACK 让出了,出帧那一段在用户浏览器里跑。
    """
    task_id = int(payload["task_id"])
    reason = str(payload.get("reason") or "frames")
    detail = str(payload.get("detail") or "")
    session = SessionLocal()
    try:
        task = task_repo.get_task(session, task_id)
        if task is None:
            logger.warning("出帧任务不存在 | task_id=%d", task_id)
            return
        if task.status in (TaskStatus.COMPLETED, TaskStatus.FAILED):
            logger.info("出帧任务已终态，跳过 | task_id=%d status=%s", task_id, task.status)
            return
        if not billing.has_open_freeze(session, task_id):
            logger.warning("出帧任务无开放冻结，跳过 | task_id=%d", task_id)
            return
        input_payload = task.input_payload or {}
        project_id = task.project_id
    finally:
        session.close()
    resume_action_client_bake(
        task_id, _action_input(input_payload), project_id, reason=reason, detail=detail
    )


def dispatch_handler(
    msg_type: str,
    payload: dict[str, Any],
    *,
    run_image_task: Callable[..., Any],
    run_action_task: Callable[..., Any],
    resume_action_poll: Callable[..., Any] | None = None,
    resume_action_client_bake: Callable[..., Any] | None = None,
    run_direction_set_task: Callable[..., Any] | None = None,
    run_view_sheet_task: Callable[..., Any] | None = None,
) -> None:
    handler = HANDLERS.get(msg_type)
    if handler is None:
        raise ValueError(f"未知消息类型: {msg_type}")
    handler(
        payload,
        run_image_task=run_image_task,
        run_action_task=run_action_task,
        resume_action_poll=resume_action_poll,
        resume_action_client_bake=resume_action_client_bake,
        run_direction_set_task=run_direction_set_task,
        run_view_sheet_task=run_view_sheet_task,
    )


def _dispatch_verification_code(payload: dict[str, Any], **_deps: Any) -> None:
    handle_verification_code(payload)


def _dispatch_generation(
    payload: dict[str, Any],
    *,
    run_image_task: Callable[..., Any],
    run_action_task: Callable[..., Any],
    run_direction_set_task: Callable[..., Any] | None = None,
    run_view_sheet_task: Callable[..., Any] | None = None,
    **_deps: Any,
) -> None:
    handle_generation(
        payload,
        run_image_task=run_image_task,
        run_action_task=run_action_task,
        run_direction_set_task=run_direction_set_task,
        run_view_sheet_task=run_view_sheet_task,
    )


def _dispatch_action_poll(
    payload: dict[str, Any],
    *,
    resume_action_poll: Callable[..., Any] | None = None,
    **_deps: Any,
) -> None:
    if resume_action_poll is None:
        raise RuntimeError("未注入 resume_action_poll")
    handle_action_poll(payload, resume_action_poll=resume_action_poll)


def _dispatch_action_client_bake(
    payload: dict[str, Any],
    *,
    resume_action_client_bake: Callable[..., Any] | None = None,
    **_deps: Any,
) -> None:
    if resume_action_client_bake is None:
        raise RuntimeError("未注入 resume_action_client_bake")
    handle_action_client_bake(payload, resume_action_client_bake=resume_action_client_bake)


HANDLERS: dict[str, Callable[..., None]] = {
    MSG_TYPE_VERIFICATION_CODE: _dispatch_verification_code,
    MSG_TYPE_CHARACTER_IMAGE: _dispatch_generation,
    MSG_TYPE_CHARACTER_ACTION: _dispatch_generation,
    MSG_TYPE_CHARACTER_ACTION_POLL: _dispatch_action_poll,
    MSG_TYPE_CHARACTER_ACTION_CLIENT_BAKE: _dispatch_action_client_bake,
}
