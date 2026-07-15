"""领域数据模型（纯数据；对应 Proposal §2.8 各实体）。"""
from __future__ import annotations
from dataclasses import dataclass, field
from enum import Enum


class LoopMode(str, Enum):
    NONE = "none"
    LINEAR = "linear"
    PINGPONG = "pingpong"


class GenRoute(str, Enum):
    A_REFIMG = "A"   # 参考图 + 姿态约束 + 锁身份（主线）
    B_I2V = "B"      # 图生视频（仅 spike 证伪）


@dataclass
class BBox:
    x: int
    y: int
    w: int
    h: int


@dataclass
class Pivot:
    x: float
    y: float


@dataclass
class Frame:
    png_path: str                 # 透明 PNG
    bbox: BBox | None = None      # 对齐后填
    pivot: Pivot | None = None    # 逐帧对齐后填（最后一公里核心数据）
    duration_ms: int = 100


@dataclass
class FrameSequence:
    action_name: str
    fps: int
    loop: LoopMode
    frames: list[Frame] = field(default_factory=list)


@dataclass
class CharacterCard:               # 人设卡 = 一致性主键
    appearance: str
    palette: str
    body_type: str
    proportion: str
    style_anchor: str
    ref_image_paths: list[str] = field(default_factory=list)


@dataclass
class AnchorFrame:
    png_path: str
    bbox: BBox
    pivot: Pivot


@dataclass
class GenerationRun:               # 生成记录（溯源 + 合规）
    action_name: str
    route: GenRoute
    model: str
    prompt: str
    seed: int
    attempts: int
    elapsed_s: float
    cost_cny: float
    license_note: str
    aigc_label: str


@dataclass
class Version:
    number: str
    parent: str | None
    note: str
    ts: str


@dataclass
class DeliveryPackage:             # 交付包（统一输出契约派生）
    target_engine: str
    sheet_path: str | None = None
    frame_pngs: list[str] = field(default_factory=list)
    json_meta_path: str | None = None       # 帧坐标/pivot/duration/loop
    gif_path: str | None = None
    engine_native_path: str | None = None   # Cocos preset 等
    provenance: list[GenerationRun] = field(default_factory=list)


@dataclass
class Character:
    name: str
    card: CharacterCard
    anchor: AnchorFrame | None = None
    actions: dict[str, FrameSequence] = field(default_factory=dict)
    version: str = "v1"


@dataclass
class Project:
    name: str
    target_engine: str = "cocos"
    style_baseline: str = ""
    characters: list[Character] = field(default_factory=list)
