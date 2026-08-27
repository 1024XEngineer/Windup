"""Quick Start Agent 对话侧车模型。"""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import BigInteger, DateTime, ForeignKey, Integer, JSON
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from windup_framework.db import Base


class QuickStartAgentConversation(Base):
    """与 WorkflowRun 一对一的 Agent 对话快照。"""

    __tablename__ = "windup_quick_start_agent_conversation"

    workflow_run_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("windup_workflow_run.id", ondelete="CASCADE"),
        primary_key=True,
    )
    turns: Mapped[list[dict]] = mapped_column(
        JSON().with_variant(JSONB, "postgresql"),
        nullable=False,
        default=list,
    )
    schema_version: Mapped[int] = mapped_column(Integer, nullable=False, default=2)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )
