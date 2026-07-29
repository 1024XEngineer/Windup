"""角色模板子领域抽象接口。

提供角色与模板资产之间的关联管理。
"""

from abc import ABC, abstractmethod

from windup_app.server.character.character_template.model import (
    AddTemplateInput,
    CharacterTemplate,
)


class CharacterTemplateService(ABC):
    """角色模板用例的稳定边界。"""

    @abstractmethod
    def add_template(self, character_id: int, input: AddTemplateInput) -> CharacterTemplate:
        """为角色添加模板。

        :raises windup_common.exceptions.BizException: asset 不存在或类型不匹配。
        """

    @abstractmethod
    def list_templates(self, character_id: int) -> list[CharacterTemplate]:
        """查询角色的所有模板版本。"""

    @abstractmethod
    def set_current(self, character_id: int, template_id: int) -> None:
        """将指定模板设为当前启用版本。"""

    @abstractmethod
    def remove(self, character_id: int, template_id: int) -> None:
        """移除角色模板关联（不删除 asset 本身）。"""