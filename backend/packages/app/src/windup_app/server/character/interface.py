"""角色领域抽象接口。

前端 master-detail 布局：

- 左侧列表：:meth:`CharacterService.list_characters`
- 右侧内容区：:meth:`CharacterService.get_character_detail`
  一次性返回模板 / 动作（按 action_type 分组）/ 穿戴道具。

子实体管理（模板/动作/穿戴）由各自领域包负责：
:mod:`windup_app.server.character.character_template` /
:mod:`windup_app.server.character.action` /
:mod:`windup_app.server.character.wearable`。
"""

from abc import ABC, abstractmethod

from windup_app.server.character.model import (
    Character,
    CharacterDetail,
    CreateCharacterInput,
    UpdateCharacterInput,
)


class CharacterService(ABC):
    """角色用例的稳定边界。"""

    # -- CRUD ------------------------------------------------------------

    @abstractmethod
    def create_character(self, input: CreateCharacterInput) -> Character:
        """创建角色。"""

    @abstractmethod
    def get_character(self, character_id: int) -> Character | None:
        """按 ID 查询角色。"""

    @abstractmethod
    def list_characters(
        self, *, project_id: int, page: int = 1, page_size: int = 20,
    ) -> tuple[list[Character], int]:
        """分页查询项目下的角色列表（左侧面板）。"""

    @abstractmethod
    def update_character(self, character_id: int, input: UpdateCharacterInput) -> Character | None:
        """更新角色名称 / 描述。"""

    @abstractmethod
    def delete_character(self, character_id: int) -> bool:
        """删除角色及其所有关联。"""

    # -- 详情聚合（右侧内容区）---------------------------------------------

    @abstractmethod
    def get_character_detail(self, character_id: int) -> CharacterDetail | None:
        """获取角色详情。

        一次性返回：
        - 角色基本信息
        - 当前启用的模板
        - 所有模板版本列表
        - 动作列表（按 action_type 分组）
        - 穿戴道具列表（含挂载定位）
        """