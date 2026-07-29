"""生成任务领域抽象接口。

采用策略模式：

- :class:`GenerationStrategy` — 策略接口，每种生成类型一个实现，
  封装输入校验、prompt 模板、模型调用。
- :class:`GenerationService` — 上下文，持有策略注册表，负责编排
  任务生命周期（提交→排队→轮询→回调），按 ``task_type`` 分发到对应策略。

新增生成能力只需新增一个 ``GenerationStrategy`` 子类并注册即可。
"""

from abc import ABC, abstractmethod

from windup_app.server.generation.model import (
    GenerationResult,
    GenerationTask,
    GenerationType,
)


# -- 策略接口 ------------------------------------------------------------

class GenerationStrategy(ABC):
    """单一生成类型的策略。

    子类 = 一种生成能力（角色图片 / 角色动作 / …）。
    """

    @property
    @abstractmethod
    def task_type(self) -> GenerationType:
        """该策略处理的生成类型。"""

    @abstractmethod
    def validate_input(self, payload: dict) -> None:
        """校验入参，不合法则抛 BizException。

        子类负责将 payload 反序列化为自己的输入模型并校验字段。
        """

    @abstractmethod
    async def generate(self, payload: dict) -> GenerationResult:
        """执行生成，返回产物 URL 列表和元数据。

        由 :class:`GenerationService` 在任务状态变为 RUNNING 后调用。
        """


# -- 上下文接口 ----------------------------------------------------------

class GenerationService(ABC):
    """生成任务用例的稳定边界。

    持有策略注册表 :meth:`register_strategy`，API 层不感知具体策略。
    """

    # -- 策略注册 ---------------------------------------------------------

    @abstractmethod
    def register_strategy(self, strategy: GenerationStrategy) -> None:
        """注册生成策略。

        通常在应用装配层调用：
        ``service.register_strategy(CharacterImageStrategy())``
        """

    # -- 任务生命周期 ------------------------------------------------------

    @abstractmethod
    def submit(
        self,
        *,
        user_id: int,
        task_type: GenerationType,
        payload: dict,
        project_id: int | None = None,
    ) -> GenerationTask:
        """提交生成任务（状态 = PENDING）。

        内部按 ``task_type`` 查找对应策略并调用 ``validate_input``，
        校验通过后持久化任务并入队。

        :raises windup_common.exceptions.BizException: 不支持的 task_type 或入参校验失败。
        """

    @abstractmethod
    def get_task(self, task_id: int) -> GenerationTask | None:
        """查询单个任务（含最新状态和结果）。"""

    @abstractmethod
    def list_tasks(
        self,
        *,
        user_id: int,
        project_id: int | None = None,
        task_type: GenerationType | None = None,
        page: int = 1,
        page_size: int = 20,
    ) -> tuple[list[GenerationTask], int]:
        """分页查询用户的任务列表，可按项目和类型过滤。"""

    @abstractmethod
    def cancel(self, task_id: int) -> bool:
        """取消未开始的任务（PENDING → 取消）。"""