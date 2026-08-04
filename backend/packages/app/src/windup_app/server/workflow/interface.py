"""工作流画布领域服务接口。

API 层只依赖本模块定义的抽象。具体实现在应用装配层继承后通过依赖注入提供。

调用流程
--------
1. 前端调用 ``POST /workflow`` 创建工作流，拿到 ``workflow_id``。
2. 前端调用 ``POST /workflow/{id}/cards`` 创建子卡片（ACTION / EXPORT）。
3. 前端调用 ``POST /cards/{id}/confirm`` 确认卡片，触发生成。
   - 返回的 ``GenerationAttempt`` 包含 ``task_id``，前端可订阅 Task SSE 获取进度。
4. 前端通过 ``GET /workflow/{id}`` 获取画布最新状态。
5. 生成完成后，前端从 ``card.latest_result`` 取出结果。

回退流程
--------
前端调用 ``POST /cards/{id}/regenerate`` 触发重新生成。
- CHARACTER：旧 CANDIDATE 全部 INACTIVE，重新生成候选。ACTION / EXPORT 不受影响。
- ACTION / EXPORT：创建新 attempt，重新执行。
"""

from __future__ import annotations

from abc import ABC, abstractmethod

from windup_app.server.workflow.model import (
    CanvasCard,
    GenerationAttempt,
    Workflow,
)


class WorkflowService(ABC):
    """工作流用例的抽象边界。"""

    # -- 工作流 CRUD --------------------------------------------------------

    @abstractmethod
    def create_workflow(self, *, user_id: int, project_id: int, name: str) -> Workflow:
        """创建工作流，自动创建 CHARACTER 根卡片。

        返回的工作流已包含一张 DRAFT 状态的 CHARACTER 卡片。
        """

    @abstractmethod
    def get_workflow(self, workflow_id: int) -> Workflow | None:
        """获取工作流详情（含全部 active 卡片）。

        返回的 Workflow.cards 已按 parent_card_id 组装为树结构。
        """

    @abstractmethod
    def delete_workflow(self, workflow_id: int) -> None:
        """删除工作流（级联软删除所有卡片和尝试记录）。"""


class CardService(ABC):
    """卡片用例的抽象边界。"""

    # -- 卡片 CRUD ----------------------------------------------------------

    @abstractmethod
    def create_card(
        self,
        workflow_id: int,
        *,
        card_type: str,
        parent_card_id: int,
        direction: str | None = None,
        user_input: dict | None = None,
        spec_overrides: dict | None = None,
    ) -> CanvasCard:
        """创建子卡片（ACTION / EXPORT）。

        ACTION 卡片创建时自动从选定的 CANDIDATE 复制母版图到 user_input.master_image_url。
        """

    @abstractmethod
    def update_card(
        self,
        card_id: int,
        *,
        user_input: dict | None = None,
        position_x: float | None = None,
        position_y: float | None = None,
    ) -> CanvasCard:
        """更新卡片用户输入或位置（不触发生成）。"""

    @abstractmethod
    def confirm_card(
        self,
        card_id: int,
        *,
        user_input: dict,
        spec_overrides: dict | None = None,
    ) -> GenerationAttempt:
        """确认卡片，触发生成。

        - CHARACTER：生成候选图 → 创建 CANDIDATE 卡片。
        - ACTION：生成动画帧。
        - EXPORT：打包导出。

        返回的 GenerationAttempt 包含 task_id，前端可订阅 Task SSE。
        """

    @abstractmethod
    def regenerate_card(
        self,
        card_id: int,
        *,
        user_input: dict | None = None,
    ) -> GenerationAttempt:
        """重新生成（创建新的 GenerationAttempt）。

        - CHARACTER：旧 CANDIDATE 全部 INACTION，重新生成候选。ACTION/EXPORT 不受影响。
        - ACTION / EXPORT：创建新 attempt，重新执行。
        """

    @abstractmethod
    def delete_card(self, card_id: int) -> None:
        """删除卡片（级联软删除所有子卡片）。"""

    @abstractmethod
    def get_card(self, card_id: int) -> CanvasCard | None:
        """获取单张卡片。"""

    @abstractmethod
    def list_cards(self, workflow_id: int) -> list[CanvasCard]:
        """获取工作流下全部 active 卡片。"""

    # -- 生成尝试 -----------------------------------------------------------

    @abstractmethod
    def get_attempts(self, card_id: int) -> list[GenerationAttempt]:
        """获取某张卡片的全部生成尝试记录。"""
