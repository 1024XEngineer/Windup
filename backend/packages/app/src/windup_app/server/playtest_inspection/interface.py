"""Playtest 核验记录服务接口。"""

from abc import ABC, abstractmethod

from sqlalchemy.orm import Session

from windup_app.server.playtest_inspection.model import PlaytestInspection


class PlaytestInspectionService(ABC):
    """读取和保存动作当前核验结论的边界。"""

    @abstractmethod
    def get_inspection(
        self,
        session: Session,
        *,
        character_id: int,
        outfit_id: str,
        action_id: str,
    ) -> PlaytestInspection | None:
        """按动作定位当前核验结论。"""

    @abstractmethod
    def save_inspection(
        self,
        session: Session,
        *,
        character_id: int,
        outfit_id: str,
        action_id: str,
        status: str,
    ) -> PlaytestInspection:
        """新增或覆盖动作当前核验结论。"""
