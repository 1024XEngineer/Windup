"""项目领域服务接口。

项目 API 只依赖本模块定义的抽象接口。数据库、缓存或其他具体实现应在
应用装配层继承 :class:`ProjectService` 后通过依赖注入提供。
"""

from abc import ABC, abstractmethod

from windup_app.server.project.model import Project


class ProjectService(ABC):
    """项目 CRUD 用例的抽象边界。"""

    @abstractmethod
    def create_project(self, project: Project) -> Project:
        """创建项目。"""

    @abstractmethod
    def project_name_exists(self, *, user_id: int, project_name: str) -> bool:
        """判断用户下的项目名称是否已存在。"""

    @abstractmethod
    def get_project(self, project_id: int) -> Project | None:
        """按 ID 查询项目。"""

    @abstractmethod
    def list_projects(
        self, *, page: int, page_size: int, user_id: int | None = None
    ) -> tuple[list[Project], int]:
        """分页查询项目。"""

    @abstractmethod
    def delete_project(self, project_id: int) -> bool:
        """删除项目并返回是否找到。"""
