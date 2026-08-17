"""生成任务的预付费积分：提交冻结，成功扣减，失败解冻。

``ref_id`` 固定为 ``task:{task_id}``，与流水表 ``(ref_id, reason)`` 唯一约束对齐。
"""

from __future__ import annotations

from sqlalchemy.orm import Session

from windup_framework.config.quota import settings as quota_settings

from windup_app.server.orchestrator.model import GenerationType
from windup_app.server.quota.service import service as quota_service


def credit_ref_id(task_id: int) -> str:
    return f"task:{task_id}"


def prepaid_cost(task_type: GenerationType) -> int:
    if task_type is GenerationType.CHARACTER_IMAGE:
        return quota_settings.generate_image_cost
    if task_type is GenerationType.CHARACTER_ACTION:
        return quota_settings.generate_action_cost
    raise ValueError(f"未知生成类型: {task_type}")


def reserve_for_task(
    session: Session, *, user_id: int, task_id: int, task_type: GenerationType,
) -> None:
    quota_service.reserve_credit(
        session, user_id, prepaid_cost(task_type), credit_ref_id(task_id),
    )


def capture_for_task(
    session: Session, *, user_id: int, task_id: int, task_type: GenerationType,
) -> None:
    amount = prepaid_cost(task_type)
    quota_service.capture_credit(
        session, user_id, amount, credit_ref_id(task_id), amount,
    )


def release_for_task(
    session: Session, *, user_id: int, task_id: int, task_type: GenerationType,
) -> None:
    quota_service.release_credit(
        session, user_id, prepaid_cost(task_type), credit_ref_id(task_id),
    )
