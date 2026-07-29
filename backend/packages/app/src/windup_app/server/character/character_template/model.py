"""角色模板子领域模型。"""

from dataclasses import dataclass, field
from datetime import datetime, timezone

from windup_app.server.character.model import AssetRef


# -- 数据模型 ------------------------------------------------------------

@dataclass
class CharacterTemplate:
    """角色模板关联（对应 ``windup_character_template`` 表）。"""

    id: int | None = None
    character_id: int = 0
    asset_id: int = 0
    is_current: bool = False
    create_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    asset: AssetRef | None = None   # join 填充


# -- 入参 ----------------------------------------------------------------

@dataclass
class AddTemplateInput:
    """添加模板入参。"""

    asset_id: int