"""项目领域服务接口。

项目 API 只依赖本模块定义的抽象接口。数据库、缓存或其他具体实现应在
应用装配层继承 :class:`ProjectService` 后通过依赖注入提供。

约定为 session-per-call:``session`` 由调用方(FastAPI 的 ``get_session`` 依赖)
按请求传入,具体实现(如 :mod:`windup_app.server.project.service`)保持无状态,
可作为模块级单例。
"""

from abc import ABC, abstractmethod

from sqlalchemy.orm import Session

from windup_app.server.project.model import Project


class ProjectService(ABC):
    """项目 CRUD 用例的抽象边界。"""

    @abstractmethod
    def create_project(self, session: Session, **fields) -> Project:
        """创建项目。

        ``fields`` 为项目字段(对齐 ``ProjectCreate`` 的字段集),由实现组装成
        :class:`Project` 后持久化。
        """

    @abstractmethod
    def project_name_exists(self, session: Session, *, user_id: int, project_name: str) -> bool:
        """判断用户下的项目名称是否已存在。"""

    @abstractmethod
    def get_project(
        self, session: Session, project_id: int, *, for_update: bool = False
    ) -> Project | None:
        """按 ID 查询项目。

        ``for_update`` 为真时对项目行加 ``SELECT ... FOR UPDATE``，供角色创建与
        项目删除互斥，避免检查与写入之间插入角色。
        """

    @abstractmethod
    def list_projects(
        self, session: Session, *, page: int, page_size: int, user_id: int | None = None
    ) -> tuple[list[Project], int]:
        """分页查询项目,返回 (当前页数据, 总数)。"""

    @abstractmethod
    def delete_project(self, session: Session, project_id: int) -> bool:
        """删除项目并返回是否找到。"""
