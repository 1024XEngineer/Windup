"""生成任务领域服务实现。

:class:`AiGenerationService` 继承 :class:`GenerationService` 接口，
编排 AI 引擎调用与任务持久化。

无状态：``session`` 由调用方按请求传入，本对象作为模块级单例
(:data:`service`)。

AI 客户端懒加载——首次调用时才创建，避免 import-time 依赖外部配置。
"""

from __future__ import annotations

import asyncio
import dataclasses
import logging
from functools import partial
from typing import Any

from sqlalchemy.orm import Session

from windup_common.enums.model import ModelErrorType
from windup_common.exceptions.model import ModelException

from windup_app.server.generation.interface import GenerationService
from windup_app.server.generation.model import (
    CharacterActionFrame,
    CharacterActionInput,
    CharacterActionOutput,
    CharacterImageInput,
    CharacterImageOutput,
    GenerationTask,
    GenerationType,
    TaskStatus,
)
from windup_app.server.generation import task_repo

logger = logging.getLogger("windup.generation.service")


class AiGenerationService(GenerationService):
    """基于 AI 引擎的生成服务编排层。

    职责：
    1. 校验入参、创建任务记录（PENDING）
    2. 调用 AI Engine 获取生成结果
    3. 将结果写回任务记录（COMPLETED / FAILED）
    4. 返回领域对象给 API 层
    """

    def __init__(self) -> None:
        self._image_client: Any | None = None
        self._video_client: Any | None = None

    # -- 任务提交 ----------------------------------------------------------

    def generate_character_image(
        self,
        session: Session,
        *,
        user_id: int,
        input: CharacterImageInput,
    ) -> GenerationTask:
        """提交角色图片生成任务。

        1. 创建任务记录（PENDING）
        2.然后返回给前端任务结果。
        3.异步调用ai_engine提供的图片生成
        4. 更行任务结果
        5. 调用media上传接口，将AI生成的图片存储进入对象存储
        6.封装返回数据，将结果写入 任务表。后续前端轮训拿到最总的URL。
        """



    def generate_character_action(
        self,
        session: Session,
        *,
        user_id: int,
        input: CharacterActionInput,
    ) -> GenerationTask:
        """提交角色动作生成任务。
        1. 创建任务记录（PENDING）
        2.然后返回给前端任务结果。
        3.异步调用ai_engine提供的动作生成
        4. 更行任务结果
        5. 调用media上传接口，将AI生成的图片存储进入对象存储
        6.封装返回数据，将结果写入 任务表。后续前端轮训拿到最总的URL。
        """

    # -- 查询 --------------------------------------------------------------

    def get_task(
        self,
        session: Session,
        project_id: int,
        task_id: int,
    ) -> GenerationTask | None:
        """查询任务状态与结果。"""
        return task_repo.get_task(session, task_id)



service = AiGenerationService()
