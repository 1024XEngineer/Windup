"""生成任务领域服务(提交 + 查询)。

:class:`AiGenerationService` 负责**建任务记录、预付费冻结、查任务**——web 层依赖本模块。
实际 AI 生成(调 ai_engine)在 :mod:`.executor` 后台跑,本模块**不碰 ai_engine**,
以满足"入口层(web/worker)不经 ai_engine 直连"的分层门禁(web → service 不得牵出 ai_engine)。

无状态:``session`` 由调用方按请求传入,本对象作模块级单例(:data:`service`)。
"""

from __future__ import annotations

import dataclasses

from sqlalchemy.orm import Session

from windup_app.server.orchestrator import billing, task_repo
from windup_app.server.orchestrator.interface import GenerationService
from windup_app.server.orchestrator.model import (
    CharacterActionInput,
    CharacterImageInput,
    GenerationTask,
    GenerationType,
)


class AiGenerationService(GenerationService):
    """生成任务服务:提交(建 PENDING 记录)+ 查询。生成执行在 executor 后台。"""

    def generate_character_image(
        self, session: Session, *, user_id: int, project_id: int | None = None,
        input: CharacterImageInput,
    ) -> GenerationTask:
        task = task_repo.create_task(
            session, user_id=user_id, project_id=project_id,
            task_type=GenerationType.CHARACTER_IMAGE,
            input_payload=dataclasses.asdict(input),
        )
        billing.reserve_for_task(
            session, user_id=user_id, task_id=task.id, task_type=task.task_type,
        )
        return task

    def generate_character_action(
        self, session: Session, *, user_id: int, project_id: int | None = None,
        input: CharacterActionInput,
    ) -> GenerationTask:
        """建动作生成任务(PENDING)并返回;实际生成由 executor 后台跑,前端轮询 get_task。"""
        task = task_repo.create_task(
            session, user_id=user_id, project_id=project_id,
            task_type=GenerationType.CHARACTER_ACTION,
            input_payload=dataclasses.asdict(input),
        )
        billing.reserve_for_task(
            session, user_id=user_id, task_id=task.id, task_type=task.task_type,
        )
        return task

    def get_task(
        self, session: Session, project_id: int, task_id: int,
    ) -> GenerationTask | None:
        return task_repo.get_task(session, task_id)


service = AiGenerationService()
