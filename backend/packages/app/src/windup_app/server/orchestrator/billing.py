"""生成任务的预付费积分：提交冻结，成功扣减，失败解冻。

``ref_id`` 固定为 ``task:{task_id}``，与流水表 ``(ref_id, reason)`` 唯一约束对齐。
结算金额一律取提交时写入的 FROZEN 流水，不读当前定价。
"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from windup_common.enums.biz_code import BizCode
from windup_common.enums.quota import CreditReason
from windup_common.exceptions import BizException
from windup_framework.config.quota import settings as quota_settings

from windup_app.server.orchestrator.model import GenerationType
from windup_app.server.quota.model import CreditTransaction
from windup_app.server.quota.service import service as quota_service


def credit_ref_id(task_id: int) -> str:
    return f"task:{task_id}"


def prepaid_cost(task_type: GenerationType) -> int:
    if task_type is GenerationType.CHARACTER_IMAGE:
        return quota_settings.generate_image_cost
    if task_type is GenerationType.CHARACTER_ACTION:
        return quota_settings.generate_action_cost
    raise ValueError(f"未知生成类型: {task_type}")


def frozen_amount_for_task(session: Session, task_id: int) -> int:
    """读取提交时冻结的额度（FROZEN 流水 ``delta`` 的绝对值）。"""
    txn = session.scalar(
        select(CreditTransaction).where(
            CreditTransaction.ref_id == credit_ref_id(task_id),
            CreditTransaction.reason == int(CreditReason.FROZEN),
        )
    )
    if txn is None:
        raise BizException("找不到该任务的冻结流水", code=BizCode.NOT_FOUND)
    return abs(txn.delta)


def has_open_freeze(session: Session, task_id: int) -> bool:
    """仍有未 capture / 未 release 的预付费冻结。"""
    frozen = session.scalar(
        select(CreditTransaction).where(
            CreditTransaction.ref_id == credit_ref_id(task_id),
            CreditTransaction.reason == int(CreditReason.FROZEN),
        )
    )
    if frozen is None:
        return False
    captured = session.scalar(
        select(CreditTransaction).where(
            CreditTransaction.ref_id == credit_ref_id(task_id),
            CreditTransaction.reason == int(CreditReason.CAPTURED),
        )
    )
    released = session.scalar(
        select(CreditTransaction).where(
            CreditTransaction.ref_id == f"{credit_ref_id(task_id)}:release",
            CreditTransaction.reason == int(CreditReason.REFUND),
        )
    )
    return captured is None and released is None


def reserve_for_task(
    session: Session, *, user_id: int, task_id: int, task_type: GenerationType,
) -> None:
    quota_service.reserve_credit(
        session, user_id, prepaid_cost(task_type), credit_ref_id(task_id),
    )


def capture_for_task(session: Session, *, user_id: int, task_id: int) -> None:
    amount = frozen_amount_for_task(session, task_id)
    quota_service.capture_credit(
        session, user_id, amount, credit_ref_id(task_id), amount,
    )


def release_for_task(session: Session, *, user_id: int, task_id: int) -> None:
    amount = frozen_amount_for_task(session, task_id)
    quota_service.release_credit(
        session, user_id, amount, credit_ref_id(task_id),
    )
