"""项目 ORM 模型。"""

from datetime import datetime, timezone

from sqlalchemy import BigInteger, DateTime, Integer, SmallInteger, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from windup_framework.db import Base


class Project(Base):
    """项目表,保存生成所需的全局约束。"""

    __tablename__ = "windup_project"
    __table_args__ = (
        UniqueConstraint("user_id", "project_name", name="uq_windup_project_user_name"),
    )

    # Postgres 上 BigInteger 自增;variant 到 Integer 让 SQLite(测试库)走
    # INTEGER PRIMARY KEY 自增(SQLite 仅对该声明自动分配 rowid)。
    id: Mapped[int] = mapped_column(
        BigInteger().with_variant(Integer, "sqlite"),
        primary_key=True,
        autoincrement=True,
    )
    user_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    workflow_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    project_name: Mapped[str] = mapped_column(String(20), nullable=False)
    character_perspective: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    directional_movement: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    sprite_width: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    sprite_height: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    game_style: Mapped[str | None] = mapped_column(Text, nullable=True)
    sprite_sample_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    create_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc)
    )
    update_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc)
    )
