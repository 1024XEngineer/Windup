"""项目 CRUD 用例。"""

import logging

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from windup_app.server.project.model import Project

logger = logging.getLogger("windup.project")


def create_project(session: Session, **values: object) -> Project:
    """创建项目并加入当前事务。"""
    logger.info(
        "[WINDUP] 创建项目 | user_id=%s project_name=%s",
        values.get("user_id"), values.get("project_name"),
    )
    project = Project(**values)
    session.add(project)
    session.flush()
    logger.info("[WINDUP] 项目创建成功 | id=%s", project.id)
    return project


def project_name_exists(session: Session, *, user_id: int, project_name: str) -> bool:
    """判断指定用户下的项目名称是否已存在。"""
    stmt = select(Project.id).where(
        Project.user_id == user_id,
        Project.project_name == project_name,
    )
    return session.scalar(stmt) is not None


def get_project(session: Session, project_id: int) -> Project | None:
    """按主键查询项目。"""
    logger.info("[WINDUP] 查询项目 | id=%s", project_id)
    result = session.get(Project, project_id)
    if result is None:
        logger.warning("[WINDUP] 项目不存在 | id=%s", project_id)
    return result


def list_projects(
    session: Session, *, page: int, page_size: int, user_id: int | None = None
) -> tuple[list[Project], int]:
    """分页查询项目,可按用户过滤。"""
    logger.info(
        "[WINDUP] 项目列表 | page=%s page_size=%s user_id=%s",
        page, page_size, user_id,
    )
    condition = Project.user_id == user_id if user_id is not None else None
    count_stmt = select(func.count()).select_from(Project)
    data_stmt = select(Project).order_by(Project.id.desc())
    if condition is not None:
        count_stmt = count_stmt.where(condition)
        data_stmt = data_stmt.where(condition)
    total = session.scalar(count_stmt) or 0
    items = list(
        session.scalars(data_stmt.offset((page - 1) * page_size).limit(page_size)).all()
    )
    logger.info("[WINDUP] 项目列表查询完成 | total=%s returned=%s", total, len(items))
    return items, total


def delete_project(session: Session, project_id: int) -> bool:
    """删除项目,返回是否找到并删除。"""
    logger.info("[WINDUP] 删除项目 | id=%s", project_id)
    project = session.get(Project, project_id)
    if project is None:
        logger.warning("[WINDUP] 删除失败-项目不存在 | id=%s", project_id)
        return False
    session.delete(project)
    session.flush()
    logger.info("[WINDUP] 项目删除成功 | id=%s", project_id)
    return True
