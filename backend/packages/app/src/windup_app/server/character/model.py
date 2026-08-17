"""角色资产 ORM 模型。

角色是隶属于项目的资产，造型、动作、动作帧等数据统一存储在
``character_data`` JSONB 字段中，不另行建表。

层级结构
--------

::

    windup_character
    └── character_data            JSONB: 角色完整数据
        └── outfits[]             list[CharacterOutfit]: 造型列表
            ├── id                str: 造型稳定 ID
            ├── name              str: 造型名称
            ├── preview_url       str | None: 造型预览图
            └── actions[]         list[CharacterAction]: 动作列表
                ├── id            str: 动作稳定 ID
                ├── type          "idle" | "walk" | "attack" | "custom"
                ├── name          str: 动作显示名称
                ├── loop          bool: 是否循环播放
                ├── fps           float: 播放帧率
                ├── frame_count   int: 帧数
                └── frames[]      list[CharacterFrame]: 帧列表
                    ├── index     int: 帧序号
                    ├── image_url str: 帧图片 URL
                    └── duration_ms int | None: 帧时长

字段说明
--------
- ``reference_image_url``: 角色参考图，即旧概念中的 Character Template
- ``character_data``: 造型→动作→帧 完整嵌套结构，由 Pydantic 模型约束
"""

from datetime import datetime, timezone

from pydantic import BaseModel, Field
from sqlalchemy import (
    BigInteger,
    DateTime,
    ForeignKey,
    Integer,
    JSON,
    SmallInteger,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from windup_common.enums.character import CharacterStatus
from windup_framework.db import Base


# ── ORM ──────────────────────────────────────────────────────────────────────


class Character(Base):
    """角色资产表。"""

    __tablename__ = "windup_character"
    __table_args__ = (
        UniqueConstraint("workflow_run_id", name="uq_windup_character_workflow_run"),
    )

    # Postgres 上 BigInteger 自增;variant 到 Integer 让 SQLite(测试库)走
    # INTEGER PRIMARY KEY 自增。
    id: Mapped[int] = mapped_column(
        BigInteger().with_variant(Integer, "sqlite"),
        primary_key=True,
        autoincrement=True,
    )

    project_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey(
            "windup_project.id",
            ondelete="RESTRICT",
            name="fk_windup_character_project_id",
        ),
        nullable=False,
    )

    workflow_run_id: Mapped[int] = mapped_column(BigInteger, nullable=False)

    name: Mapped[str | None] = mapped_column(String(20), nullable=True)

    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    reference_image_url: Mapped[str | None] = mapped_column(Text, nullable=True)

    # 造型、动作、动作帧等完整数据;Postgres 上 JSONB,SQLite 上 JSON。
    character_data: Mapped[dict] = mapped_column(
        JSON().with_variant(JSONB, "postgresql"),
        nullable=False,
        default=dict,
    )

    # HTTP 创建/更新会根据真实动作帧重新计算；草稿默认值保护其他服务写入不被误发布。
    status: Mapped[int] = mapped_column(
        SmallInteger, nullable=False, default=CharacterStatus.DRAFT
    )

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


# ── character_data Pydantic 模型 ──────────────────────────────────────────────


class CharacterFrame(BaseModel):
    """动作帧。"""

    index: int = Field(ge=0, description="帧序号")
    image_url: str = Field(..., description="帧图片 URL")
    duration_ms: int | None = Field(default=None, gt=0, description="帧时长(毫秒)")


class CharacterAction(BaseModel):
    """动作（从属于某个造型）。"""

    id: str = Field(..., description="动作稳定 ID")
    type: str = Field(..., description="动作类型: idle / walk / attack / custom")
    name: str = Field(..., description="动作显示名称")
    loop: bool = Field(default=False, description="是否循环播放")
    fps: float = Field(default=12, gt=0, description="播放帧率")
    frame_count: int = Field(ge=0, description="帧数")
    frames: list[CharacterFrame] = Field(default_factory=list, description="帧列表")


class CharacterOutfit(BaseModel):
    """造型。"""

    id: str = Field(..., description="造型稳定 ID")
    name: str = Field(..., description="造型名称")
    description: str | None = Field(default=None, description="造型描述")
    preview_url: str | None = Field(default=None, description="造型预览图 URL")
    actions: list[CharacterAction] = Field(default_factory=list, description="该造型下的动作列表")


class CharacterData(BaseModel):
    """角色完整数据（造型→动作→帧）。"""

    version: int = Field(default=1, description="结构版本")
    outfits: list[CharacterOutfit] = Field(default_factory=list, description="造型列表")
