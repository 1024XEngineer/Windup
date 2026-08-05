"""Playtest 核验记录 ORM 模型。"""

from datetime import datetime, timezone

from sqlalchemy import BigInteger, DateTime, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from windup_framework.db import Base


class PlaytestInspection(Base):
    """某个角色动作当前最新的 Playtest 核验结论。"""

    __tablename__ = "windup_playtest_inspection"
    __table_args__ = (
        UniqueConstraint(
            "character_id",
            "outfit_id",
            "action_id",
            name="uq_playtest_inspection_target",
        ),
    )

    id: Mapped[int] = mapped_column(
        BigInteger().with_variant(Integer, "sqlite"),
        primary_key=True,
        autoincrement=True,
    )
    character_id: Mapped[int] = mapped_column(BigInteger, nullable=False, index=True)
    outfit_id: Mapped[str] = mapped_column(String(128), nullable=False)
    action_id: Mapped[str] = mapped_column(String(128), nullable=False)
    status: Mapped[str] = mapped_column(String(24), nullable=False)
    create_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )
    update_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )
