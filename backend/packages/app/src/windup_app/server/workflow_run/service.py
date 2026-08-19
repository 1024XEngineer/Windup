"""工作流执行记录领域服务的 SQLAlchemy 实现。

:class:`SqlAlchemyWorkflowRunService` 继承 :class:`WorkflowRunService` 接口，用同步
SQLAlchemy session 落库。无状态：``session`` 由调用方按请求传入，本对象可作
模块级单例（:data:`service`）。

事务边界由 ``windup_framework.db.get_session`` 依赖负责——成功 commit、异常
rollback，故本实现只 ``flush``（把变更发到当前事务、取回生成的主键），不 commit。
"""

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from windup_common.enums.biz_code import BizCode
from windup_common.exceptions import BizException

from windup_app.server.workflow_run.interface import WorkflowRunService
from windup_app.server.workflow_run.model import RunStatus, WorkflowRun


def _version_conflict() -> None:
    raise BizException(
        "执行记录版本冲突，请刷新后重试",
        code=BizCode.CONFLICT,
    )


class SqlAlchemyWorkflowRunService(WorkflowRunService):
    """基于 SQLAlchemy session 的执行记录 CRUD 实现。"""

    def create_run(
        self,
        session: Session,
        *,
        project_id: int,
        nodes: list | None = None,
    ) -> WorkflowRun:
        run = WorkflowRun(
            project_id=project_id,
            nodes=nodes or [],
        )
        session.add(run)
        session.flush()
        return run

    def get_run(self, session: Session, run_id: int) -> WorkflowRun | None:
        return session.get(WorkflowRun, run_id)

    def list_runs(
        self,
        session: Session,
        *,
        project_id: int,
        page: int = 1,
        page_size: int = 20,
    ) -> tuple[list[WorkflowRun], int]:
        """分页查询项目下的执行记录，返回 (当前页数据, 总数)。"""
        count_stmt = (
            select(func.count())
            .select_from(WorkflowRun)
            .where(
                WorkflowRun.project_id == project_id,
                WorkflowRun.status != RunStatus.SOFT_DELETED.value,
            )
        )
        stmt = (
            select(WorkflowRun)
            .where(
                WorkflowRun.project_id == project_id,
                WorkflowRun.status != RunStatus.SOFT_DELETED.value,
            )
            .order_by(WorkflowRun.id.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
        total = session.scalar(count_stmt) or 0
        items = list(session.scalars(stmt))
        return items, total

    def update_run(
        self,
        session: Session,
        run_id: int,
        *,
        expected_version: int,
        nodes: list | None = None,
        status: RunStatus | None = None,
    ) -> WorkflowRun | None:
        run = session.get(WorkflowRun, run_id)
        if run is None:
            return None

        values: dict[str, object] = {}
        if nodes is not None and nodes != run.nodes:
            values["nodes"] = nodes
        if status is not None and status.value != run.status:
            values["status"] = status.value

        if not values:
            if run.version != expected_version:
                _version_conflict()
            return run

        values["version"] = expected_version + 1
        result = session.execute(
            update(WorkflowRun)
            .where(
                WorkflowRun.id == run_id,
                WorkflowRun.version == expected_version,
            )
            .values(**values)
            .execution_options(synchronize_session="fetch")
        )
        if result.rowcount == 0:
            _version_conflict()
        session.refresh(run)
        return run

    def delete_run(self, session: Session, run_id: int) -> bool:
        run = session.get(WorkflowRun, run_id)
        if run is None:
            return False
        if run.status == RunStatus.SOFT_DELETED.value:
            return True
        result = session.execute(
            update(WorkflowRun)
            .where(WorkflowRun.id == run_id)
            .values(
                status=RunStatus.SOFT_DELETED.value,
                version=WorkflowRun.version + 1,
            )
            .execution_options(synchronize_session="fetch")
        )
        return result.rowcount > 0


service = SqlAlchemyWorkflowRunService()
