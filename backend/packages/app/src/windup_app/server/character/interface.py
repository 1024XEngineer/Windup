"""角色领域服务接口。

角色 API 只依赖本模块定义的抽象接口。具体实现（SQLAlchemy 等）应在
应用装配层继承 :class:`CharacterService` 后通过依赖注入提供。

约定
----
- session-per-call: ``session`` 由调用方（FastAPI 的 ``get_session`` 依赖）按请求传入。
- 具体实现保持无状态，可作为模块级单例。
- ``character_data`` 内造型/动作/帧的校验由 Pydantic schema 在 API 层完成，
  接口层不感知其内部结构。
"""

from abc import ABC, abstractmethod

from sqlalchemy.orm import Session

from windup_app.server.character.model import Character


class CharacterService(ABC):
    """角色 CRUD 用例的抽象边界。"""

    @abstractmethod
    def create_character(self, session: Session, **fields) -> Character:
        """创建角色。

        ``fields`` 对齐请求体的字段集，由实现组装成 :class:`Character` 后持久化。
        """

    @abstractmethod
    def get_character(self, session: Session, character_id: int) -> Character | None:
        """按 ID 查询角色。"""

    @abstractmethod
    def get_character_by_workflow_run(
        self,
        session: Session,
        workflow_run_id: int,
    ) -> Character | None:
        """按 WorkflowRun ID 查询唯一角色。"""

    @abstractmethod
    def list_characters(
        self, session: Session, *, project_id: int, page: int, page_size: int,
        status: int | None = None,
    ) -> tuple[list[Character], int]:
        """分页查询项目下的角色列表，返回 (当前页数据, 总数)。

        ``status``: 可选，按发布状态过滤（0=草稿，1=已发布）。
        """

    @abstractmethod
    def project_has_characters(self, session: Session, project_id: int) -> bool:
        """判断项目下是否仍挂载角色（草稿或已发布均算）。"""

    @abstractmethod
    def update_character(self, session: Session, character_id: int, **fields) -> Character | None:
        """更新角色描述、参考图或 character_data 等字段。

        返回更新后的角色；不存在时返回 ``None``。
        """

    @abstractmethod
    def delete_character(self, session: Session, character_id: int) -> bool:
        """删除角色并返回是否找到。"""
