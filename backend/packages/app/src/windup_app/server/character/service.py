"""角色领域服务的 SQLAlchemy 实现。

:class:`SqlAlchemyCharacterService` 继承 :class:`CharacterService` 接口,用同步
SQLAlchemy session 落库。无状态:``session`` 由调用方按请求传入,本对象可作
模块级单例(:data:`service`)。

事务边界由 ``windup_framework.db.get_session`` 依赖负责--成功 commit、异常
rollback,故本实现只 ``flush``(把变更发到当前事务、取回生成的主键),不 commit。
"""

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from windup_app.server.character.interface import CharacterService
from windup_app.server.character.model import Character
from windup_app.server.character.naming import CharacterNamer, resolve_character_name


class SqlAlchemyCharacterService(CharacterService):
    """基于 SQLAlchemy session 的角色 CRUD 实现。"""

    def __init__(self, namer: CharacterNamer | None = None) -> None:
        self._namer = namer

    def create_character(self, session: Session, **fields) -> Character:
        fields = dict(fields)
        workflow_run_id = fields.get("workflow_run_id")
        existing = (
            self.get_character_by_workflow_run(session, workflow_run_id)
            if workflow_run_id is not None
            else None
        )
        if existing is not None and existing.project_id == fields.get("project_id"):
            return existing
        name = fields.get("name")
        # 已有同 workflow_run（含跨项目冲突）不再打 LLM，插入交给唯一约束。
        namer = None if (name or "").strip() or existing is not None else self._namer
        fields["name"] = resolve_character_name(name, fields.get("description"), namer)
        character = Character(**fields)
        session.add(character)
        session.flush()
        return character

    def get_character(self, session: Session, character_id: int) -> Character | None:
        return session.get(Character, character_id)

    def get_character_by_workflow_run(
        self,
        session: Session,
        workflow_run_id: int,
    ) -> Character | None:
        stmt = select(Character).where(Character.workflow_run_id == workflow_run_id)
        return session.scalar(stmt)

    def list_characters(
        self, session: Session, *, project_id: int, page: int, page_size: int,
        status: int | None = None,
    ) -> tuple[list[Character], int]:
        base_condition = Character.project_id == project_id
        if status is not None:
            base_condition = base_condition & (Character.status == status)

        count_stmt = (
            select(func.count())
            .select_from(Character)
            .where(base_condition)
        )
        stmt = (
            select(Character)
            .where(base_condition)
            .order_by(Character.id.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
        total = session.scalar(count_stmt) or 0
        items = list(session.scalars(stmt))
        return items, total

    def project_has_characters(self, session: Session, project_id: int) -> bool:
        stmt = (
            select(Character.id)
            .where(Character.project_id == project_id)
            .limit(1)
        )
        return session.scalar(stmt) is not None

    def update_character(
        self, session: Session, character_id: int, **fields,
    ) -> Character | None:
        character = session.get(Character, character_id)
        if character is None:
            return None
        for key, value in fields.items():
            setattr(character, key, value)
        session.flush()
        return character

    def delete_character(self, session: Session, character_id: int) -> bool:
        character = session.get(Character, character_id)
        if character is None:
            return False
        session.delete(character)
        session.flush()
        return True


service = SqlAlchemyCharacterService()
