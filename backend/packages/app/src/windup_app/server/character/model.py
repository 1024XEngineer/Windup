"""角色领域模型。"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from windup_app.server.character.action.model import CharacterAction
    from windup_app.server.character.character_template.model import CharacterTemplate
    from windup_app.server.character.wearable.model import CharacterWearable


# -- 数据模型 ------------------------------------------------------------

@dataclass
class Character:
    """角色（对应 ``windup_character`` 表）。"""

    id: int | None = None
    project_id: int = 0
    name: str = ""
    description: str | None = None
    status: int = 0
    create_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    update_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))


@dataclass
class AssetRef:
    """资产引用（精简版，避免详情接口返回冗余字段）。

    各子包（action / character_template / wearable）的关联模型
    通过 ``asset: AssetRef`` 字段引用此类型。
    """

    id: int
    asset_type: str            # character_template / character_action / wearable
    name: str
    file_url: str
    thumbnail_url: str = ""
    width: int | None = None
    height: int | None = None
    frame_count: int = 0
    duration_ms: int | None = None
    metadata: dict[str, Any] = field(default_factory=dict)


# -- 详情聚合（前端右侧内容区）-------------------------------------------

@dataclass
class ActionGroup:
    """按动作类型分组的动作列表。"""

    action_type: str
    items: list[CharacterAction] = field(default_factory=list)


@dataclass
class CharacterDetail:
    """角色详情——右侧面板一次性返回所有关联数据。"""

    character: Character
    current_template: CharacterTemplate | None = None   # 当前启用的模板
    templates: list[CharacterTemplate] = field(default_factory=list)
    actions: list[ActionGroup] = field(default_factory=list)  # 按 action_type 分组
    wearables: list[CharacterWearable] = field(default_factory=list)


# -- 入参 ----------------------------------------------------------------

@dataclass
class CreateCharacterInput:
    """创建角色入参。"""

    project_id: int
    name: str
    description: str | None = None


@dataclass
class UpdateCharacterInput:
    """更新角色入参。"""

    name: str | None = None
    description: str | None = None