"""画风预设读写。"""

from sqlalchemy import select
from sqlalchemy.orm import Session

from windup_app.server.style_preset.model import StylePreset

service: "StylePresetService"


class StylePresetService:
    def list_enabled(self, session: Session) -> list[StylePreset]:
        stmt = (
            select(StylePreset)
            .where(StylePreset.enabled == 1)
            .order_by(StylePreset.sort_order, StylePreset.id)
        )
        return list(session.scalars(stmt))

    def get(self, session: Session, preset_id: int) -> StylePreset | None:
        return session.get(StylePreset, preset_id)

    def create(self, session: Session, **fields) -> StylePreset:
        preset = StylePreset(**fields)
        session.add(preset)
        session.flush()
        return preset

    def update(self, session: Session, preset: StylePreset, **fields) -> StylePreset:
        for key, value in fields.items():
            setattr(preset, key, value)
        session.flush()
        return preset


service = StylePresetService()
