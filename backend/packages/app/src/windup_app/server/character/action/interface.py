"""角色动作子领域抽象接口。

提供角色与动作资产之间的关联管理。
"""

from abc import ABC, abstractmethod

from windup_app.server.character.action.model import AddActionInput, CharacterAction


class CharacterActionService(ABC):
    """角色动作用例的稳定边界。"""

    @abstractmethod
    def add_action(self, character_id: int, input: AddActionInput) -> CharacterAction:
        """为角色添加动作。

        :param input.action_type: walk / idle / attack / jump / custom。
        :raises windup_common.exceptions.BizException: asset 不存在或类型不匹配。
        """

    @abstractmethod
    def list_actions(self, character_id: int) -> list[CharacterAction]:
        """查询角色的所有动作。"""

    @abstractmethod
    def remove(self, character_id: int, action_id: int) -> None:
        """移除角色动作关联（不删除 asset 本身）。"""