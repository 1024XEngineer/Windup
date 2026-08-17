"""项目领域服务的 SQLAlchemy 实现。

:class:`SqlAlchemyProjectService` 继承 :class:`ProjectService` 接口,用同步
SQLAlchemy session 落库。无状态:``session`` 由调用方按请求传入,本对象可作
模块级单例(:data:`service`)。

事务边界由 ``windup_framework.db.get_session`` 依赖负责--成功 commit、异常
rollback,故本实现只 ``flush``(把变更发到当前事务、取回生成的主键),不 commit。
"""

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from windup_app.server.project.interface import ProjectService
from windup_app.server.project.model import Project


class SqlAlchemyProjectService(ProjectService):
    """基于 SQLAlchemy session 的项目 CRUD 实现。"""

    def create_project(self, session: Session, **fields) -> Project:
        project = Project(**fields)
        session.add(project)
        session.flush()  # 取回自增主键 id 与 Python 侧默认值(create_at/update_at)
        return project

    def project_name_exists(self, session: Session, *, user_id: int, project_name: str) -> bool:
        stmt = (
            select(Project.id)
            .where(Project.user_id == user_id, Project.project_name == project_name)
            .limit(1)
        )
        return session.scalar(stmt) is not None

    def get_project(
        self, session: Session, project_id: int, *, for_update: bool = False
    ) -> Project | None:
        if not for_update:
            return session.get(Project, project_id)
        return session.scalar(
            select(Project).where(Project.id == project_id).with_for_update()
        )

    def list_projects(
        self, session: Session, *, page: int, page_size: int, user_id: int | None = None
    ) -> tuple[list[Project], int]:
        count_stmt = select(func.count()).select_from(Project)
        stmt = select(Project)
        if user_id is not None:
            count_stmt = count_stmt.where(Project.user_id == user_id)
            stmt = stmt.where(Project.user_id == user_id)
        total = session.scalar(count_stmt) or 0
        stmt = stmt.order_by(Project.id.desc()).offset((page - 1) * page_size).limit(page_size)
        items = list(session.scalars(stmt))
        return items, total

    def delete_project(self, session: Session, project_id: int) -> bool:
        project = session.get(Project, project_id)
        if project is None:
            return False
        session.delete(project)
        session.flush()
        return True


service = SqlAlchemyProjectService()
