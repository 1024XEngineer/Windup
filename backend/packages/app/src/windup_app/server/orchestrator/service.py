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
    CharacterDirectionSetInput,
    CharacterDirectionSetOutput,
    CharacterFirstFrameInput,
    CharacterImageInput,
    CharacterViewSheetInput,
    EIGHT_VIEW_MODEL_CALLS_PER_SHEET,
    FOUR_VIEW_MODEL_CALLS_PER_SHEET,
    GenerationTask,
    GenerationType,
    TaskStatus,
    initial_direction_set_output,
)
from windup_app.server.sensitive_word.interface import SensitiveWordService
from windup_app.server.sensitive_word.service import service as sensitive_word_service


class AiGenerationService(GenerationService):
    """生成任务服务:提交(建 PENDING 记录)+ 查询。生成执行在 executor 后台。"""

    def __init__(
        self,
        sensitive_filter: SensitiveWordService = sensitive_word_service,
    ) -> None:
        self._sensitive_filter = sensitive_filter

    def _assert_clean(
        self,
        *,
        user_id: int,
        source: str,
        texts: tuple[str | None, ...],
    ) -> None:
        for text in texts:
            if text:
                self._sensitive_filter.assert_clean(
                    text,
                    user_id=user_id,
                    source=source,
                )

    def generate_character_image(
        self, session: Session, *, user_id: int, project_id: int | None = None,
        input: CharacterImageInput,
    ) -> GenerationTask:
        self._assert_clean(
            user_id=user_id,
            source="generation.image",
            texts=(input.prompt, input.negative_prompt),
        )
        task = task_repo.create_task(
            session, user_id=user_id, project_id=project_id,
            task_type=GenerationType.CHARACTER_IMAGE,
            input_payload=dataclasses.asdict(input),
        )
        billing.reserve_for_task(
            session, user_id=user_id, task_id=task.id, task_type=task.task_type,
            model_calls=max(1, input.num_images),
        )
        return task

    def generate_character_four_view(
        self,
        session: Session,
        *,
        user_id: int,
        project_id: int,
        input: CharacterViewSheetInput,
    ) -> GenerationTask:
        return self._submit_view_sheet(
            session,
            user_id=user_id,
            project_id=project_id,
            input=input,
            task_type=GenerationType.CHARACTER_FOUR_VIEW,
            model_calls_per_sheet=FOUR_VIEW_MODEL_CALLS_PER_SHEET,
        )

    def generate_character_eight_view(
        self,
        session: Session,
        *,
        user_id: int,
        project_id: int,
        input: CharacterViewSheetInput,
    ) -> GenerationTask:
        return self._submit_view_sheet(
            session,
            user_id=user_id,
            project_id=project_id,
            input=input,
            task_type=GenerationType.CHARACTER_EIGHT_VIEW,
            model_calls_per_sheet=EIGHT_VIEW_MODEL_CALLS_PER_SHEET,
        )

    def generate_character_first_frame(
        self,
        session: Session,
        *,
        user_id: int,
        project_id: int,
        input: CharacterFirstFrameInput,
    ) -> GenerationTask:
        self._assert_clean(
            user_id=user_id,
            source="generation.first_frame",
            texts=(input.prompt, input.negative_prompt),
        )
        task = task_repo.create_task(
            session,
            user_id=user_id,
            project_id=project_id,
            task_type=GenerationType.CHARACTER_FIRST_FRAME,
            input_payload=dataclasses.asdict(input),
        )
        billing.reserve_for_task(
            session,
            user_id=user_id,
            task_id=task.id,
            task_type=task.task_type,
            model_calls=max(1, input.num_images or 1),
        )
        return task

    def _submit_view_sheet(
        self,
        session: Session,
        *,
        user_id: int,
        project_id: int,
        input: CharacterViewSheetInput,
        task_type: GenerationType,
        model_calls_per_sheet: int,
    ) -> GenerationTask:
        self._assert_clean(
            user_id=user_id,
            source=f"generation.{task_type.value}",
            texts=(input.prompt, input.negative_prompt),
        )
        task = task_repo.create_task(
            session,
            user_id=user_id,
            project_id=project_id,
            task_type=task_type,
            input_payload=dataclasses.asdict(input),
        )
        billing.reserve_for_task(
            session,
            user_id=user_id,
            task_id=task.id,
            task_type=task.task_type,
            model_calls=max(1, input.num_images or 1) * model_calls_per_sheet,
        )
        return task

    def generate_character_direction_set(
        self,
        session: Session,
        *,
        user_id: int,
        project_id: int,
        input: CharacterDirectionSetInput,
    ) -> GenerationTask:
        if (
            input.character_id is None
            or input.anchor_direction is None
            or not input.reference_image_url
        ):
            raise ValueError("新方向集任务必须绑定已确认角色母版")
        if not input.directions:
            raise ValueError("方向集不能为空")
        self._assert_clean(
            user_id=user_id,
            source="generation.direction_set",
            texts=(input.prompt, input.negative_prompt),
        )
        input.billing_attempt = 0
        task = task_repo.create_task(
            session,
            user_id=user_id,
            project_id=project_id,
            task_type=GenerationType.CHARACTER_DIRECTION_SET,
            input_payload=dataclasses.asdict(input),
        )
        generated_direction_count = sum(
            direction is not input.anchor_direction for direction in input.directions
        )
        if generated_direction_count:
            billing.reserve_for_task(
                session,
                user_id=user_id,
                task_id=task.id,
                task_type=task.task_type,
                model_calls=generated_direction_count * max(1, input.num_images),
            )
        else:
            task_repo.update_progress(
                session,
                task.id,
                GenerationType.CHARACTER_DIRECTION_SET.value,
                dataclasses.asdict(initial_direction_set_output(input)),
                status=TaskStatus.COMPLETED,
            )
            task = task_repo.get_task(session, task.id)
        return task

    def retry_failed_directions(
        self,
        session: Session,
        *,
        task: GenerationTask,
    ) -> GenerationTask:
        if (
            task.task_type is not GenerationType.CHARACTER_DIRECTION_SET
            or task.status not in (TaskStatus.PARTIAL, TaskStatus.FAILED)
            or not isinstance(task.result, CharacterDirectionSetOutput)
        ):
            raise ValueError("只有部分失败的方向集任务可以重试")
        failed = [
            item
            for item in task.result.directions
            if item.status != TaskStatus.COMPLETED.value
        ]
        if not failed:
            raise ValueError("没有可重试的失败方向")

        payload = dict(task.input_payload or {})
        attempt = int(payload.get("billing_attempt") or 0) + 1
        payload["billing_attempt"] = attempt
        billing.reserve_for_task(
            session,
            user_id=task.user_id,
            task_id=task.id,
            task_type=task.task_type,
            model_calls=len(failed) * max(1, int(payload.get("num_images") or 1)),
            attempt=attempt,
        )
        for item in failed:
            item.status = TaskStatus.PENDING.value
            item.error_message = None
            item.image_urls = []
            item.quality = None
        task_repo.update_input_payload(session, task.id, payload)
        task_repo.update_progress(
            session,
            task.id,
            GenerationType.CHARACTER_DIRECTION_SET.value,
            dataclasses.asdict(task.result),
            status=TaskStatus.PENDING,
        )
        return task_repo.get_task(session, task.id)

    def generate_character_action(
        self, session: Session, *, user_id: int, project_id: int | None = None,
        input: CharacterActionInput,
    ) -> GenerationTask:
        """建动作生成任务(PENDING)并返回;实际生成由 executor 后台跑,前端轮询 get_task。"""
        self._assert_clean(
            user_id=user_id,
            source="generation.action",
            texts=(input.custom_prompt,),
        )
        task = task_repo.create_task(
            session, user_id=user_id, project_id=project_id,
            task_type=GenerationType.CHARACTER_ACTION,
            input_payload=dataclasses.asdict(input),
        )
        billing.reserve_for_task(
            session, user_id=user_id, task_id=task.id, task_type=task.task_type,
            model_calls=1,
        )
        return task

    def get_task(
        self, session: Session, project_id: int, task_id: int,
    ) -> GenerationTask | None:
        return task_repo.get_task(session, task_id)


service = AiGenerationService()
