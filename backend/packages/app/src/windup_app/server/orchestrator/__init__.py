"""生成任务编排(orchestrator):提交 / 调度 / 查询生成任务。

本包只做**任务编排调度**——建任务记录、后台驱动执行、查询状态;实际 AI 生成
(调 ai_engine)在 :mod:`.executor` 后台跑。原名 ``generation``,更名为 ``orchestrator``
以准确表达职责(调度而非生成本身)。
"""

from windup_app.server.orchestrator.model import (
    ActionType,
    CharacterActionFrame,
    CharacterActionInput,
    CharacterActionOutput,
    CharacterImageInput,
    GenerationTask,
    GenerationTaskRecord,
    GenerationType,
    TaskStatus,
)
from windup_app.server.orchestrator.service import service as generation_service
from windup_app.server.orchestrator import task_repo

__all__ = [
    "ActionType",
    "CharacterActionFrame",
    "CharacterActionInput",
    "CharacterActionOutput",
    "CharacterImageInput",
    "GenerationTask",
    "GenerationTaskRecord",
    "GenerationType",
    "TaskStatus",
    "generation_service",
    "task_repo",
]
