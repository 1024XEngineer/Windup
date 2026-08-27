"""敏感词领域模型。"""

from dataclasses import dataclass
from datetime import datetime, timezone
from enum import IntEnum

from sqlalchemy import BigInteger, Boolean, DateTime, Integer, SmallInteger, String
from sqlalchemy.orm import Mapped, mapped_column

from windup_framework.db import Base


class SensitiveWordCategory(IntEnum):
    """敏感词分类。"""

    CONTENT = 1
    INJECTION = 2


class SensitiveWord(Base):
    """敏感词表；Postgres 是词库的唯一真相。"""

    __tablename__ = "windup_sensitive_word"

    id: Mapped[int] = mapped_column(
        BigInteger().with_variant(Integer, "sqlite"),
        primary_key=True,
        autoincrement=True,
    )
    word: Mapped[str] = mapped_column(String(128), unique=True, nullable=False)
    category: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
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


@dataclass(frozen=True)
class SensitiveWordView:
    id: int
    word: str
    category: SensitiveWordCategory
    enabled: bool
    create_at: datetime
    update_at: datetime


@dataclass(frozen=True)
class SensitiveHit:
    word: str
    category: SensitiveWordCategory
    start: int
    end: int
