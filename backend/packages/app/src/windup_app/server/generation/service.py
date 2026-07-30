"""生成任务领域服务的 SQLAlchemy 实现。

:class:`SqlAlchemyGenerationService` 继承 :class:`GenerationService` 接口,
用同步 SQLAlchemy session 落库。无状态:``session`` 由调用方按请求传入。

事务边界由 ``windup_framework.db.get_session`` 依赖负责,本实现只 ``flush``。

生成任务的实际 AI 调用(图片/视频生成)由上层编排,本服务只负责:
1. 创建任务记录(PENDING)
2. 查询任务状态
3. 更新任务结果/失败(供编排层回调)
"""

from dataclasses import asdict

from sqlalchemy import select
from sqlalchemy.orm import Session

from windup_app.server.generation.interface import GenerationService
from windup_app.server.generation.model import (
    CharacterActionFrame,
    CharacterActionInput,
    CharacterActionOutput,
    CharacterImageInput,
    CharacterImageOutput,
    GenerationTask,
    GenerationTaskRecord,
    GenerationType,
    TaskStatus,
)

# result_type 字符串 → dataclass 的映射,用于反序列化
_RESULT_TYPES: dict[str, type] = {
    "CharacterImageOutput": CharacterImageOutput,
    "CharacterActionOutput": CharacterActionOutput,
}


def _record_to_task(record: GenerationTaskRecord) -> GenerationTask:
    """ORM 记录 → 领域 dataclass。"""
    result = None
    if record.result and record.result_type:
        cls = _RESULT_TYPES.get(record.result_type)
        if cls:
            if cls is CharacterActionOutput:
                frames = [
                    CharacterActionFrame(**f) for f in record.result.get("frames", [])
                ]
                result = cls(
                    action_type=record.result.get("action_type", ""),
                    frames=frames,
                )
            else:
                result = cls(**record.result)

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


class SqlAlchemyGenerationService(GenerationService):
    """基于 SQLAlchemy session 的生成任务 CRUD 实现。"""

    def generate_character_image(
        self, session: Session, *, user_id: int, input: CharacterImageInput,
    ) -> GenerationTask:
        record = GenerationTaskRecord(
            user_id=user_id,
            task_type=GenerationType.CHARACTER_IMAGE.value,
            status=TaskStatus.PENDING.value,
            input_payload=asdict(input),
        )
        session.add(record)
        session.flush()
        return _record_to_task(record)

    def generate_character_action(
        self, session: Session, *, user_id: int, input: CharacterActionInput,
    ) -> GenerationTask:
        record = GenerationTaskRecord(
            user_id=user_id,
            task_type=GenerationType.CHARACTER_ACTION.value,
            status=TaskStatus.PENDING.value,
            input_payload=asdict(input),
        )
        session.add(record)
        session.flush()
        return _record_to_task(record)

    def get_task(
        self, session: Session, project_id: int, task_id: int,
    ) -> GenerationTask | None:
        stmt = select(GenerationTaskRecord).where(
            GenerationTaskRecord.id == task_id,
            GenerationTaskRecord.project_id == project_id,
        )
        record = session.scalar(stmt)
        if record is None:
            return None
        return _record_to_task(record)

    # -- 编排层回调 --------------------------------------------------------

    def mark_running(self, session: Session, task_id: int) -> GenerationTask | None:
        """将任务标记为运行中。"""
        record = session.get(GenerationTaskRecord, task_id)
        if record is None:
            return None
        record.status = TaskStatus.RUNNING.value
        session.flush()
        return _record_to_task(record)

    def mark_completed(
        self,
        session: Session,
        task_id: int,
        result: CharacterImageOutput | CharacterActionOutput,
    ) -> GenerationTask | None:
        """标记任务完成并写入结果。"""
        record = session.get(GenerationTaskRecord, task_id)
        if record is None:
            return None
        record.status = TaskStatus.COMPLETED.value
        record.result_type = type(result).__name__
        record.result = asdict(result)
        session.flush()
        return _record_to_task(record)

    def mark_failed(
        self, session: Session, task_id: int, error_message: str,
    ) -> GenerationTask | None:
        """标记任务失败并写入错误信息。"""
        record = session.get(GenerationTaskRecord, task_id)
        if record is None:
            return None
        record.status = TaskStatus.FAILED.value
        record.error_message = error_message
        session.flush()
        return _record_to_task(record)


service = SqlAlchemyGenerationService()
