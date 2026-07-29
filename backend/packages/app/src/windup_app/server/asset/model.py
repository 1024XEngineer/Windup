"""资产库领域模型。"""

from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import StrEnum
from typing import Any


# -- 枚举 ----------------------------------------------------------------

class AssetType(StrEnum):
    """资产类型——与 ``windup_asset.asset_type`` 对齐。"""

    CHARACTER_TEMPLATE = "character_template"
    CHARACTER_ACTION = "character_action"
    WEARABLE = "wearable"


# -- 数据模型 ------------------------------------------------------------

@dataclass
class Asset:
    """资产（对应 ``windup_asset`` 表）。"""

    id: int | None = None
    project_id: int = 0
    asset_type: AssetType = AssetType.CHARACTER_TEMPLATE
    name: str = ""
    description: str | None = None
    file_url: str = ""
    thumbnail_url: str = ""
    file_size: int = 0
    width: int | None = None
    height: int | None = None
    frame_count: int = 0
    duration_ms: int | None = None
    metadata: dict[str, Any] = field(default_factory=dict)
    status: int = 0                          # 0=正常 1=归档
    create_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    update_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))


# -- 入参 ----------------------------------------------------------------

@dataclass
class CreateAssetInput:
    """创建资产入参。"""

    project_id: int
    asset_type: AssetType
    name: str
    file_url: str
    thumbnail_url: str = ""
    description: str | None = None
    file_size: int = 0
    width: int | None = None
    height: int | None = None
    frame_count: int = 0
    duration_ms: int | None = None
    metadata: dict[str, Any] | None = None


@dataclass
class UpdateAssetInput:
    """更新资产入参（仅允许更新名称/描述/缩略图/元数据，文件本体不可变）。"""

    name: str | None = None
    description: str | None = None
    thumbnail_url: str | None = None
    metadata: dict[str, Any] | None = None


@dataclass
class ListAssetsFilter:
    """资产列表筛选条件。"""

    asset_type: AssetType | None = None
    keyword: str | None = None               # 按名称模糊搜索
    status: int | None = None                # 0=正常 1=归档，None=全部