"""生成任务领域服务接口。

API 层只依赖本模块定义的抽象。具体实现（AI 引擎调用、任务队列等）
在应用装配层继承 :class:`GenerationService` 后通过依赖注入提供。

调用流程
--------
1. 前端调用 ``generate_character_image`` / ``generate_character_action`` 提交任务，
   拿到 ``task_id``。
2. 前端通过 SSE 订阅任务状态变更,无需轮询。
   web 层提供 ``GET /generation/tasks/{task_id}/stream`` 端点,
   服务端在任务状态变化时推送 ``task_update`` 事件。
   事件 payload 包含 ``task_id`` / ``task_type`` / ``status``,
   完成时附带 ``result``,失败时附带 ``error_message``。
3. 前端从 ``task.status`` 判断完成,从 ``result`` 取出出参,回填 character 模块：

   .. code-block:: text

       CharacterImageOutput.image_url  → Character.reference_image_url
       CharacterActionOutput.frames[]  → character_data.outfits[].actions[].frames[]
"""

from abc import ABC, abstractmethod

from windup_app.server.orchestrator.model import (
    CharacterActionInput,
    CharacterImageInput,
    GenerationTask,
)


class GenerationService(ABC):
    """生成任务用例的抽象边界。"""

    # -- 任务提交 ------------------------------------------------------------

    @abstractmethod
    def generate_character_image(self, input: CharacterImageInput) -> GenerationTask:
        """提交角色图片生成任务。

        入参包含参考图 URL 和 prompt 等参数；出参为 ``CharacterImageOutput``，
        前端拿到 ``image_url`` 后回填 ``Character.reference_image_url``。
        """

    @abstractmethod
    def generate_character_action(self, input: CharacterActionInput) -> GenerationTask:
        """提交角色动作生成任务。

        入参包含角色 ID、动作类型和参考素材；出参为 ``CharacterActionOutput``，
        前端拿到 ``frames[]`` 后回填 ``character_data.outfits[].actions[].frames[]``。
        """

    # -- 查询 ----------------------------------------------------------------

    @abstractmethod
    def get_task(self, project_id: int, task_id: int) -> GenerationTask | None:
        """查询任务状态与结果。

        返回完整的 ``GenerationTask``，前端根据 ``status`` 判断是否完成，
        从 ``result`` 中读取对应类型的出参。
        """
