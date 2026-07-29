"""角色穿戴子领域抽象接口。

提供角色与穿戴道具资产之间的关联管理，
包括挂载定位（槽位 / 位置 / 缩放 / 旋转 / 层级）。
"""

from abc import ABC, abstractmethod

from windup_app.server.character.wearable.model import (
    CharacterWearable,
    EquipWearableInput,
    UpdateWearablePositionInput,
)


class CharacterWearableService(ABC):
    """角色穿戴用例的稳定边界。"""

    @abstractmethod
    def equip(self, character_id: int, input: EquipWearableInput) -> CharacterWearable:
        """为角色穿戴道具。

        :raises windup_common.exceptions.BizException: asset 不存在或类型不匹配。
        """

    @abstractmethod
    def list_wearables(self, character_id: int) -> list[CharacterWearable]:
        """查询角色的所有穿戴道具。"""

    @abstractmethod
    def update_position(
        self, character_id: int, wearable_id: int, input: UpdateWearablePositionInput,
    ) -> CharacterWearable:
        """调整穿戴道具的位置 / 缩放 / 旋转 / 层级。"""

    @abstractmethod
    def unequip(self, character_id: int, wearable_id: int) -> None:
        """卸下穿戴道具（不删除 asset 本身）。"""