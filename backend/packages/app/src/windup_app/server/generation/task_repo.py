"""生成任务数据访问层。

纯 CRUD 操作，不含业务逻辑。所有函数接收 ``session: Session``，
由调用方（FastAPI ``get_session`` 依赖）管理事务边界——本模块只
``flush`` 不 ``commit``。
"""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from windup_app.server.generation.model import (
    CharacterActionOutput,
    CharacterImageOutput,
    GenerationTask,
    GenerationTaskRecord,
    GenerationType,
    TaskStatus,
)


# ── 写入 ─────────────────────────────────────────────────────────────────


def create_task(
    session: Session,
    *,
    user_id: int,
    project_id: int | None,
    task_type: GenerationType,
    input_payload: dict,
) -> GenerationTask:
    """创建生成任务记录，返回领域对象。"""
    record = GenerationTaskRecord(
        user_id=user_id,
        project_id=project_id,
        task_type=task_type.value,
        status=TaskStatus.PENDING.value,
        input_payload=input_payload,
    )
    session.add(record)
    session.flush()
    return _record_to_domain(record)


def update_status(
    session: Session,
    task_id: int,
    status: TaskStatus,
    *,
    error_message: str | None = None,
) -> None:
    """更新任务状态（可选附带错误信息）。"""
    record = session.get(GenerationTaskRecord, task_id)
    if record is None:
        return
    record.status = status.value
    record.error_message = error_message
    record.update_at = datetime.now(timezone.utc)
    session.flush()


def update_result(
    session: Session,
    task_id: int,
    result_type: str,
    result: dict,
) -> None:
    """写入任务结果。"""
    record = session.get(GenerationTaskRecord, task_id)
    if record is None:
        return
    record.result_type = result_type
    record.result = result
    record.status = TaskStatus.COMPLETED.value
    record.update_at = datetime.now(timezone.utc)
    session.flush()


# ── 读取 ─────────────────────────────────────────────────────────────────


def get_task(session: Session, task_id: int) -> GenerationTask | None:
    """按 task_id 查询任务。"""
    record = session.get(GenerationTaskRecord, task_id)
    if record is None:
        return None
    return _record_to_domain(record)


def get_task_by_user(
    session: Session,
    user_id: int,
    task_id: int,
) -> GenerationTask | None:
    """按 user_id + task_id 查询（校验归属）。"""
    stmt = select(GenerationTaskRecord).where(
        GenerationTaskRecord.id == task_id,
        GenerationTaskRecord.user_id == user_id,
    )
    record = session.scalar(stmt)
    if record is None:
        return None
    return _record_to_domain(record)


# ── 转换 ─────────────────────────────────────────────────────────────────


def _record_to_domain(record: GenerationTaskRecord) -> GenerationTask:
    """ORM 记录 → 领域 dataclass。"""
    result = _deserialize_result(record.result_type, record.result)
    return GenerationTask(
        id=record.id,
        user_id=record.user_id,
        project_id=record.project_id,
        task_type=GenerationType(record.task_type),
        status=TaskStatus(record.status),
        input_payload=record.input_payload,
        result=result,
        error_message=record.error_message,
        create_at=record.create_at,
        update_at=record.update_at,
    )


def _deserialize_result(
    result_type: str | None,
    raw: dict | None,
) -> CharacterImageOutput | CharacterActionOutput | None:
    """根据 ``result_type`` 将 JSON dict 反序列化为对应的 dataclass。"""
    if raw is None or result_type is None:
        return None
    if result_type == "character_image":
        return CharacterImageOutput(
            type=raw.get("type", "character_image"),
            image_urls=raw.get("image_urls", []),
        )
    if result_type == "character_action":
        from windup_app.server.generation.model import CharacterActionFrame

        frames = [
            CharacterActionFrame(
                index=f["index"],
                image_url=f["image_url"],
                duration_ms=f.get("duration_ms"),
            )
            for f in raw.get("frames", [])
        ]
        return CharacterActionOutput(
            type=raw.get("type", "character_action"),
            action_type=raw.get("action_type", ""),
            frames=frames,
        )
    return None
