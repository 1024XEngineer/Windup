"""角色动作子领域模型。"""

from dataclasses import dataclass, field
from datetime import datetime, timezone

from windup_app.server.character.model import AssetRef


# -- 数据模型 ------------------------------------------------------------

@dataclass
class CharacterAction:
    """角色动作关联（对应 ``windup_character_action`` 表）。"""

    id: int | None = None
    character_id: int = 0
    asset_id: int = 0
    action_type: str = ""         # walk / idle / attack / jump / custom
    create_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    asset: AssetRef | None = None


# -- 入参 ----------------------------------------------------------------

@dataclass
class AddActionInput:
    """添加动作入参。"""

    asset_id: int
    action_type: str              # walk / idle / attack / jump / custom