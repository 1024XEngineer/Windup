"""生成任务领域。"""

from windup_app.server.generation.model import (
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
from windup_app.server.generation.service import service as generation_service
from windup_app.server.generation import task_repo

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
