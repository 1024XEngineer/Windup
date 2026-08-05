"""Playtest 核验记录的 SQLAlchemy 实现。"""

from sqlalchemy import select
from sqlalchemy.orm import Session

from windup_app.server.playtest_inspection.interface import PlaytestInspectionService
from windup_app.server.playtest_inspection.model import PlaytestInspection


class SqlAlchemyPlaytestInspectionService(PlaytestInspectionService):
    """只保留每个动作最新核验结论，不形成历史版本链。"""

    def get_inspection(
        self,
        session: Session,
        *,
        character_id: int,
        outfit_id: str,
        action_id: str,
    ) -> PlaytestInspection | None:
        statement = select(PlaytestInspection).where(
            PlaytestInspection.character_id == character_id,
            PlaytestInspection.outfit_id == outfit_id,
            PlaytestInspection.action_id == action_id,
        )
        return session.scalar(statement)

    def save_inspection(
        self,
        session: Session,
        *,
        character_id: int,
        outfit_id: str,
        action_id: str,
        status: str,
    ) -> PlaytestInspection:
        inspection = self.get_inspection(
            session,
            character_id=character_id,
            outfit_id=outfit_id,
            action_id=action_id,
        )
        if inspection is None:
            inspection = PlaytestInspection(
                character_id=character_id,
                outfit_id=outfit_id,
                action_id=action_id,
                status=status,
            )
            session.add(inspection)
        else:
            inspection.status = status
        session.flush()
        return inspection


service = SqlAlchemyPlaytestInspectionService()
