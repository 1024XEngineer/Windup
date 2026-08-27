"""角色资产 ORM 模型。

角色是隶属于项目的资产，造型、动作、动作帧等数据统一存储在
``character_data`` JSONB 字段中，不另行建表。

层级结构
--------

::

    windup_character
    └── character_data            JSONB: 角色完整数据
        ├── templates[]           list[CharacterTemplateSequence]: 各源方向母版与镜像关系
        └── outfits[]             list[CharacterOutfit]: 造型列表
            ├── id                str: 造型稳定 ID
            ├── name              str: 造型名称
            ├── preview_url       str | None: 造型预览图
            ├── model_3d_url      str | None: 该造型的绑骨 3D 模型（三渲二路线的开关）
            └── actions[]         list[CharacterAction]: 动作列表
                ├── id            str: 动作稳定 ID
                ├── type          "idle" | "walk" | "attack" | "custom"
                ├── locomotion    bool: 是否会让角色整体发生空间位移
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
from typing import Literal

from pydantic import BaseModel, Field, model_validator
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
from windup_common.models import CharacterStance
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


ActionDirection = Literal[
    "east",
    "west",
    "north",
    "south",
    "north_east",
    "north_west",
    "south_east",
    "south_west",
]

class CharacterActionSequence(BaseModel):
    """一个动作的源方向帧或水平镜像关系。"""

    direction: ActionDirection
    source_direction: ActionDirection | None = Field(
        default=None, description="镜像方向引用的真实源方向"
    )
    mirror_x: bool = Field(default=False, description="是否水平镜像源方向")
    frame_count: int = Field(ge=0, description="该方向声明的帧数")
    frames: list[CharacterFrame] = Field(
        default_factory=list, description="该方向帧列表"
    )

    @model_validator(mode="after")
    def validate_source_or_mirror(self) -> "CharacterActionSequence":
        if self.mirror_x != (self.source_direction is not None):
            raise ValueError("动作方向镜像关系无效")
        if self.source_direction is not None:
            if self.source_direction == self.direction:
                raise ValueError("动作方向不能镜像自身")
            if self.frames:
                raise ValueError("镜像动作方向不能保存独立帧")
            return self
        if self.frame_count != len(self.frames) or self.frame_count == 0:
            raise ValueError("真实动作方向必须包含与 frame_count 一致的帧")
        if sorted(frame.index for frame in self.frames) != list(range(self.frame_count)):
            raise ValueError("真实动作方向帧序号必须从 0 连续递增")
        return self


class CharacterTemplateSequence(BaseModel):
    """角色母版的真实源方向或水平镜像关系。"""

    direction: ActionDirection
    source_direction: ActionDirection | None = Field(
        default=None, description="镜像方向引用的真实源方向"
    )
    mirror_x: bool = Field(default=False, description="是否水平镜像源方向")
    image_url: str | None = Field(default=None, description="真实源方向的母版 URL")

    @model_validator(mode="after")
    def validate_source_or_mirror(self) -> "CharacterTemplateSequence":
        if self.mirror_x != (self.source_direction is not None):
            raise ValueError("角色母版方向镜像关系无效")
        if self.source_direction is not None:
            if self.source_direction == self.direction:
                raise ValueError("角色母版方向不能镜像自身")
            if self.image_url is not None:
                raise ValueError("镜像角色母版不能保存独立图片")
            return self
        if not self.image_url or not self.image_url.strip():
            raise ValueError("真实方向必须包含角色母版 URL")
        return self


class CharacterAction(BaseModel):
    """动作（从属于某个造型）。"""

    id: str = Field(..., description="动作稳定 ID")
    type: str = Field(..., description="动作类型: idle / walk / attack / custom")
    name: str = Field(..., description="动作显示名称")
    locomotion: bool = Field(default=False, description="是否会让角色整体发生空间位移")
    loop: bool = Field(default=False, description="是否循环播放")
    fps: float = Field(default=12, gt=0, description="播放帧率")
    frame_count: int = Field(ge=0, description="帧数")
    frames: list[CharacterFrame] = Field(default_factory=list, description="帧列表")
    sequences: list[CharacterActionSequence] = Field(
        default_factory=list,
        description="可选多方向源序列与镜像关系；旧数据的 frames 视为 east",
    )
    # 逐帧水平位移，单位「1.0 = 角色总高」，与出帧台的归一化口径一致。
    #
    # **只装出帧台从根骨动画轨读出的那一份**，不装 postprocess.rootmotion 从交付帧像素
    # 反推的那一份：后者是在帧已被对齐成原地之后再猜，信息在对齐那一步就损失了；前者
    # 是作者意图的精确值，且在三渲二这条路上是白送的。i2v 路线没有骨架，只能用反推的，
    # 那条不写进本字段，免得同一个字段装着两种精度的数还分不出来。
    root_motion: list[tuple[float, float]] | None = Field(
        default=None, description="逐帧 (dx, dz) 位移，来源为根骨动画轨；None = 未采集"
    )

    @model_validator(mode="after")
    def validate_direction_relations(self) -> "CharacterAction":
        by_direction: dict[str, CharacterActionSequence] = {}
        for sequence in self.sequences:
            if sequence.direction in by_direction:
                raise ValueError("同一动作不能包含重复方向")
            by_direction[sequence.direction] = sequence

        for sequence in self.sequences:
            source_direction = sequence.source_direction
            if source_direction is None:
                continue
            source = by_direction.get(source_direction)
            if source is None or source.source_direction is not None or source.mirror_x:
                raise ValueError("镜像动作方向缺少真实源方向")
            if sequence.frame_count != source.frame_count:
                raise ValueError("镜像动作方向帧数必须与源方向一致")
        return self


class OutfitRigFacts(BaseModel):
    """绑骨模型的骨架事实。**记录用，不是判据。**

    出帧台每渲一段动作都会从模型里读出这些数，此前算完即丢（#774）。存下来是为了
    让「这个造型的骨架长什么样」不必每次重新解析 GLB，也让挂点有据可查——自动绑骨
    保留了挂点骨，武器握持按骨名定位即可，不必重新标定。

    为什么不当闸：曾以「28 骨 · humanoid 命名 · 无 mixamorig 前缀」作硬校验，2026-08-26
    量全部归档产物即推翻——骨数是 24 / 27 / 28 / 43 / 49，其中 24 与 27 正是混元自己绑
    的四足，同一条链路出来的骨数就不是常数；带前缀的那个是 Mixamo 绑的，属重定向路线
    的正常输入。据此当闸会把自家产物一起挡掉。
    """

    bones: int = Field(..., ge=0, description="骨骼数量。随模型变，不是常数")
    root_bone: str | None = Field(default=None, description="根骨名；读不出时为 None")
    bone_names: list[str] = Field(
        default_factory=list, description="骨名列表。挂点的来源——武器握持按骨名定位"
    )
    skinned_meshes: int = Field(default=0, ge=0, description="蒙皮网格数")
    vertices: int = Field(default=0, ge=0, description="顶点数")
    available_clips: dict[str, float] = Field(
        default_factory=dict, description="模型自带的预设动作 → 时长（秒）"
    )


class CharacterOutfit(BaseModel):
    """造型。"""

    id: str = Field(..., description="造型稳定 ID")
    name: str = Field(..., description="造型名称")
    description: str | None = Field(default=None, description="造型描述")
    preview_url: str | None = Field(default=None, description="造型预览图 URL")
    # 该造型的**绑骨 3D 模型**存储 URL;``None`` = 还没建。三渲二路线的开关就是它:
    # server 读到有值就调 CharacterGeneratorPort.generate_rendered,读到 None 就走 i2v。
    #
    # 挂在造型一级而非角色一级(#121):外观挂在造型上(每个造型自带 preview_url),
    # 角色级只有一张参考图,同一角色的不同造型共用不了一个 3D 模型。
    #
    # 建这份资产是**每造型一次性**的按次计费(图生 3D + 绑骨),不在动作生成的请求
    # 路径上 —— 见 orchestrator.render3d_assets.Render3DAssetBuilder。
    model_3d_url: str | None = Field(
        default=None, description="该造型的绑骨 3D 模型 URL;None = 未建,三渲二不可用"
    )
    # 与 model_3d_url 同批产出、每造型一次性。可空:存量造型没有这份数据,
    # 而缺它不影响出帧(出帧台自己会再读一遍),所以不做回填。
    rig_facts: OutfitRigFacts | None = Field(
        default=None, description="绑骨模型的骨架事实；None = 未建或建于本字段之前"
    )
    actions: list[CharacterAction] = Field(
        default_factory=list, description="该造型下的动作列表"
    )


class CharacterData(BaseModel):
    """角色完整数据（方向母版与造型→动作→帧）。"""

    version: int = Field(default=1, ge=1, description="结构版本")
    # 角色体型。决定"手臂/手肘"这类人体部位词能不能进提示词 —— 非双足角色的描述里
    # 出现它们,模型会凭空接上一对人的上肢,而帧数/时长/成色全部正常、没有一道会红。
    #
    # 存在角色上而不是每次动作请求带:体型是角色的属性,不是这次生成的选项。
    # 放在请求里的那份(``CreateActionInput.stance``)此前 558/558 个任务一个都没传过,
    # 三道按体型分流的判据因此全是死代码(#840)。
    #
    # ``None`` = 没人选过,**与"选了双足"是两回事**。不在这里兜 BIPED:兜了的话
    # 每个新建角色都会把默认值实体化写进 character_data,于是"有人确认过它是人形"
    # 和"从来没人看过这个字段"再也分不开 —— 而那正是 #840 本身的形状。
    # 双足这个默认值由 ``CharacterCard.stance`` 定义一次,下游取不到时用它。
    stance: CharacterStance | None = Field(
        default=None, description="角色体型(双足/四足/无肢);未设置时下游按双足处理"
    )
    templates: list[CharacterTemplateSequence] = Field(
        default_factory=list, description="角色各源方向母版与镜像关系"
    )
    outfits: list[CharacterOutfit] = Field(default_factory=list, description="造型列表")

    @model_validator(mode="after")
    def validate_template_relations(self) -> "CharacterData":
        by_direction: dict[str, CharacterTemplateSequence] = {}
        for template in self.templates:
            if template.direction in by_direction:
                raise ValueError("角色母版不能包含重复方向")
            by_direction[template.direction] = template

        for template in self.templates:
            source_direction = template.source_direction
            if source_direction is None:
                continue
            source = by_direction.get(source_direction)
            if (
                source is None
                or source.source_direction is not None
                or source.mirror_x
                or not source.image_url
            ):
                raise ValueError("镜像角色母版缺少真实源方向")
        return self
