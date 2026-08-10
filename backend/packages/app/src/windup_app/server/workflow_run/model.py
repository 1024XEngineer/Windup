"""工作流执行记录领域模型。

后端只做存储，不感知节点结构。
节点树由前端维护，通过 workflow_run.nodes JSONB 字段全量读写。
"""

from __future__ import annotations

from datetime import datetime, timezone
from enum import StrEnum

from sqlalchemy import BigInteger, DateTime, Integer, JSON, String
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from windup_framework.db import Base


# -- 枚举 ----------------------------------------------------------------


class RunStatus(StrEnum):
    """执行记录状态。"""

    ACTIVE = "active"
    SOFT_DELETED = "soft_deleted"


# -- ORM -----------------------------------------------------------------


class WorkflowRun(Base):
    """执行记录表——前端维护的节点树的持久化容器。

    后端不校验 nodes 内部结构，仅做全量读写。
    """

    __tablename__ = "windup_workflow_run"

    id: Mapped[int] = mapped_column(
        BigInteger().with_variant(Integer, "sqlite"),
        primary_key=True,
        autoincrement=True,
    )

    project_id: Mapped[int] = mapped_column(BigInteger, nullable=False)

    # 节点树（前端自定义结构，后端不校验）；Postgres 上 JSONB，SQLite 上 JSON。
    nodes: Mapped[list] = mapped_column(
        JSON().with_variant(JSONB, "postgresql"),
        nullable=False,
        default=list,
    )

    status: Mapped[str] = mapped_column(
        String(20), nullable=False, default=RunStatus.ACTIVE.value,
    )

    version: Mapped[int] = mapped_column(
        Integer, nullable=False, default=1,
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )
