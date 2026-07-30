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


class SqlAlchemyCharacterService(CharacterService):
    """基于 SQLAlchemy session 的角色 CRUD 实现。"""

    def create_character(self, session: Session, **fields) -> Character:
        character = Character(**fields)
        session.add(character)
        session.flush()
        return character

    def get_character(self, session: Session, character_id: int) -> Character | None:
        return session.get(Character, character_id)

    def list_characters(
        self, session: Session, *, project_id: int, page: int, page_size: int,
    ) -> tuple[list[Character], int]:
        count_stmt = (
            select(func.count())
            .select_from(Character)
            .where(Character.project_id == project_id)
        )
        stmt = (
            select(Character)
            .where(Character.project_id == project_id)
            .order_by(Character.id.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
        total = session.scalar(count_stmt) or 0
        items = list(session.scalars(stmt))
        return items, total

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
