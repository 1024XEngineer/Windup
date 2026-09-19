"""生成任务的预付费积分：提交冻结，成功扣减，失败解冻。

首次 ``ref_id`` 为 ``task:{task_id}``；方向集重试追加 ``:retry:{attempt}``，
与流水表 ``(ref_id, reason)`` 唯一约束对齐。
冻结额 = 该模态单价 × 本任务计划的上游模型调用次数。
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


def credit_ref_id(task_id: int, attempt: int = 0) -> str:
    if attempt < 0:
        raise ValueError("attempt 必须 >= 0")
    return f"task:{task_id}" if attempt == 0 else f"task:{task_id}:retry:{attempt}"


def attempt_for_task(task_type: GenerationType | str, input_payload: dict | None) -> int:
    """普通任务固定轮次 0；方向集从持久化入参读取当前重试轮次。"""
    value = task_type.value if isinstance(task_type, GenerationType) else str(task_type)
    if value != GenerationType.CHARACTER_DIRECTION_SET.value:
        return 0
    return int((input_payload or {}).get("billing_attempt") or 0)


def prepaid_cost(task_type: GenerationType, model_calls: int) -> int:
    """单价 × 本任务计划的上游模型调用次数。"""
    if model_calls < 1:
        raise ValueError(f"model_calls 必须 >= 1, 得到 {model_calls}")
    if task_type in (
        GenerationType.CHARACTER_IMAGE,
        GenerationType.CHARACTER_DIRECTION_SET,
        GenerationType.CHARACTER_FOUR_VIEW,
        GenerationType.CHARACTER_EIGHT_VIEW,
        GenerationType.CHARACTER_FIRST_FRAME,
    ):
        return quota_settings.generate_image_cost * model_calls
    if task_type is GenerationType.CHARACTER_ACTION:
        return quota_settings.generate_action_cost * model_calls
    raise ValueError(f"未知生成类型: {task_type}")


def frozen_amount_for_task(session: Session, task_id: int, attempt: int = 0) -> int:
    """读取提交时冻结的额度（FROZEN 流水 ``delta`` 的绝对值）。"""
    txn = session.scalar(
        select(CreditTransaction).where(
            CreditTransaction.ref_id == credit_ref_id(task_id, attempt),
            CreditTransaction.reason == int(CreditReason.FROZEN),
        )
    )
    if txn is None:
        raise BizException("找不到该任务的冻结流水", code=BizCode.NOT_FOUND)
    return abs(txn.delta)


def has_open_freeze(session: Session, task_id: int, attempt: int = 0) -> bool:
    """仍有未 capture / 未 release 的预付费冻结。"""
    frozen = session.scalar(
        select(CreditTransaction).where(
            CreditTransaction.ref_id == credit_ref_id(task_id, attempt),
            CreditTransaction.reason == int(CreditReason.FROZEN),
        )
    )
    if frozen is None:
        return False
    captured = session.scalar(
        select(CreditTransaction).where(
            CreditTransaction.ref_id == credit_ref_id(task_id, attempt),
            CreditTransaction.reason == int(CreditReason.CAPTURED),
        )
    )
    released = session.scalar(
        select(CreditTransaction).where(
            CreditTransaction.ref_id == f"{credit_ref_id(task_id, attempt)}:release",
            CreditTransaction.reason == int(CreditReason.REFUND),
        )
    )
    return captured is None and released is None


def reserve_for_task(
    session: Session, *, user_id: int, task_id: int, task_type: GenerationType,
    model_calls: int, attempt: int = 0,
) -> None:
    quota_service.reserve_credit(
        session,
        user_id,
        prepaid_cost(task_type, model_calls),
        credit_ref_id(task_id, attempt),
    )


def capture_for_task(
    session: Session,
    *,
    user_id: int,
    task_id: int,
    attempt: int = 0,
    actual_amount: int | None = None,
) -> None:
    amount = frozen_amount_for_task(session, task_id, attempt)
    if actual_amount is not None and not 0 <= actual_amount <= amount:
        raise ValueError(
            f"实际结算额必须在 0..{amount} 之间，得到 {actual_amount}"
        )
    quota_service.capture_credit(
        session,
        user_id,
        amount if actual_amount is None else actual_amount,
        credit_ref_id(task_id, attempt),
        amount,
    )


def release_for_task(
    session: Session, *, user_id: int, task_id: int, attempt: int = 0
) -> None:
    amount = frozen_amount_for_task(session, task_id, attempt)
    quota_service.release_credit(
        session, user_id, amount, credit_ref_id(task_id, attempt),
    )
