"""画风预设 ORM。全局目录,运营增删行即可扩展风格,不改表。"""

from datetime import datetime, timezone

from sqlalchemy import BigInteger, DateTime, Integer, SmallInteger, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from windup_framework.db import Base


class StylePreset(Base):
    """画风预设表。

    一行 = 一种可选画风。前端选出后把 ``prompt`` / ``sample_url`` / ``sprite_width``
    / ``sprite_height`` 填进 Project 已有字段;``stylize`` 给生成管线(含三渲二出口)。
    """

    __tablename__ = "windup_style_preset"
    __table_args__ = (UniqueConstraint("code", name="uq_windup_style_preset_code"),)

    id: Mapped[int] = mapped_column(
        BigInteger().with_variant(Integer, "sqlite"),
        primary_key=True,
        autoincrement=True,
    )
    code: Mapped[str] = mapped_column(String(32), nullable=False)
    name: Mapped[str] = mapped_column(String(40), nullable=False)
    kind: Mapped[str] = mapped_column(String(32), nullable=False)
    prompt: Mapped[str] = mapped_column(Text, nullable=False)
    sample_url: Mapped[str] = mapped_column(Text, nullable=False)
    stylize: Mapped[str] = mapped_column(String(16), nullable=False)
    sprite_width: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    sprite_height: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    enabled: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=1)
    create_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc)
    )
    update_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )
