"""角色穿戴子领域模型。"""

from dataclasses import dataclass, field
from datetime import datetime, timezone

from windup_app.server.character.model import AssetRef


# -- 数据模型 ------------------------------------------------------------

@dataclass
class CharacterWearable:
    """角色穿戴关联（对应 ``windup_character_wearable`` 表）。"""

    id: int | None = None
    character_id: int = 0
    asset_id: int = 0
    slot_type: str | None = None
    position_x: float = 0
    position_y: float = 0
    scale: float = 1.0
    rotation: float = 0
    z_order: int = 0
    create_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    asset: AssetRef | None = None


# -- 入参 ----------------------------------------------------------------

@dataclass
class EquipWearableInput:
    """穿戴道具入参。"""

    asset_id: int
    slot_type: str | None = None
    position_x: float = 0
    position_y: float = 0
    scale: float = 1.0
    rotation: float = 0
    z_order: int = 0


@dataclass
class UpdateWearablePositionInput:
    """调整穿戴位置入参。"""

    position_x: float | None = None
    position_y: float | None = None
    scale: float | None = None
    rotation: float | None = None
    z_order: int | None = None