"""工作流画布 API Schema。

定义前端请求/响应的 Pydantic 模型，与 server 层解耦。
前端团队参考此文件了解接口契约。

卡片输入参数按 card_type 区分，每种类型有明确的 user_input / spec_overrides 结构。
"""

from __future__ import annotations

from enum import StrEnum
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from windup_app.server.workflow.model import (
    Direction,
)


# ══════════════════════════════════════════════════════════════════════════════
# 工作流
# ══════════════════════════════════════════════════════════════════════════════


class WorkflowCreateRequest(BaseModel):
    """创建工作流。

    自动创建一张 CHARACTER 根卡片作为画布起点。
    """

    project_id: int = Field(description="关联项目 ID，项目约束从这里读取")
    name: str = Field(default="未命名工作流", max_length=100, description="工作流名称")


class WorkflowOut(BaseModel):
    """工作流详情响应（含全部 active 卡片）。"""

    model_config = ConfigDict(from_attributes=True)

    id: int
    project_id: int | None = None
    name: str
    status: str = Field(description="active / archived")
    project_context: dict = Field(
        default_factory=dict,
        description="项目约束快照：{perspective, sprite_width, sprite_height, game_style, ...}",
    )
    version: int = Field(description="乐观锁版本号，更新时需携带")
    cards: list[CanvasCardOut] = Field(default_factory=list, description="全部有效卡片")


# ══════════════════════════════════════════════════════════════════════════════
# 卡片输入参数（按 card_type 显式定义）
# ══════════════════════════════════════════════════════════════════════════════


# ── CHARACTER 卡片 ────────────────────────────────────────────────────────────


class CharacterConfirmInput(BaseModel):
    """CHARACTER 卡片确认时的用户输入。

    用户填写角色描述后提交，后端生成 N 张候选图。
    """

    description: str = Field(min_length=1, max_length=500, description="角色描述，如'甲壳虫战士，手持长剑'")
    num_images: int = Field(default=6, ge=1, le=12, description="生成候选图数量，默认6张")


class CharacterUpdateInput(BaseModel):
    """CHARACTER 卡片更新时的用户输入（选定候选后回填）。"""

    selected_candidate_id: int | None = Field(default=None, description="选定的 CANDIDATE 卡片 ID")


# ── ACTION 卡片 ───────────────────────────────────────────────────────────────


class PresetActionType(StrEnum):
    """预设动作类型——规格与提示词已预先优化。"""

    IDLE = "idle"
    WALK = "walk"
    RUN = "run"
    JUMP = "jump"


class ActionCreateInput(BaseModel):
    """ACTION 卡片创建时的用户输入。"""

    action_type: PresetActionType | str = Field(
        description="动作类型：预设(idle/walk/run/jump) 或自定义(任意字符串)"
    )
    action_name: str | None = Field(
        default=None, max_length=50,
        description="自定义动作名称（action_type 为自定义时必填）",
    )
    description: str = Field(
        min_length=1, max_length=300,
        description="动作描述，如'大步流星地走'、'向上跳跃'",
    )
    reference_image_url: str | None = Field(
        default=None,
        description="姿势参考图 URL（自定义动作可选，预设动作忽略）",
    )


class ActionSpecOverrides(BaseModel):
    """ACTION 卡片高级项覆盖。

    这些参数有默认值，用户可在"高级项"中覆盖。
    覆盖后卡片上出现记号标明该处已偏离默认。
    """

    num_frames: int = Field(default=36, ge=1, le=120, description="生成帧数，默认36帧")
    fps: int = Field(default=10, ge=1, le=60, description="帧率，默认10 FPS")
    loop: Literal["none", "linear", "pingpong"] = Field(
        default="linear", description="循环模式：none=不循环, linear=线性, pingpong=乒乓"
    )


# ── EXPORT 卡片 ──────────────────────────────────────────────────────────────


class ExportFormat(StrEnum):
    """导出格式。"""

    PNG_SEQUENCE = "png_sequence"      # PNG 序列帧
    SPRITE_SHEET = "sprite_sheet"      # 精灵图集
    PLIST = "plist"                    # Cocos SpriteFrames


class ExportCreateInput(BaseModel):
    """EXPORT 卡片创建时的用户输入。"""

    formats: list[ExportFormat] = Field(
        min_length=1,
        description="导出格式列表，至少选一种",
    )
    fps: int = Field(default=10, ge=1, le=60, description="导出帧率")


# ── latest_result 结构（按 card_type）─────────────────────────────────────────


class CharacterLatestResult(BaseModel):
    """CHARACTER 生成结果。"""

    candidate_ids: list[int] = Field(description="生成的 CANDIDATE 卡片 ID 列表")


class CandidateLatestResult(BaseModel):
    """CANDIDATE 生成结果（与 user_input 相同）。"""

    image_url: str = Field(description="候选图 URL")


class ActionFrame(BaseModel):
    """动画帧。"""

    index: int = Field(description="帧序号，从0开始")
    image_url: str = Field(description="帧图片 URL")
    duration_ms: int = Field(default=125, description="帧持续时间(ms)")


class ActionLatestResult(BaseModel):
    """ACTION 生成结果。"""

    first_frame_url: str | None = Field(default=None, description="首帧图 URL")
    frames: list[ActionFrame] = Field(default_factory=list, description="完整动画帧序列")


class ExportLatestResult(BaseModel):
    """EXPORT 生成结果。"""

    package_url: str = Field(description="导出包下载 URL")


# ══════════════════════════════════════════════════════════════════════════════
# 画布卡片请求/响应
# ══════════════════════════════════════════════════════════════════════════════


class CardCreateRequest(BaseModel):
    """创建子卡片（ACTION / EXPORT）。

    由前端"+"菜单触发，parent_card_id 必须指向一张 CHARACTER 卡片。
    ACTION 卡片创建时自动从选定的 CANDIDATE 复制母版图。
    """

    card_type: Literal["action", "export"] = Field(description="卡片类型")
    parent_card_id: int = Field(description="父卡片 ID，必须是 CHARACTER 类型")
    direction: Direction | None = Field(default=None, description="方向：front/side/back/left，单方向时省略")
    user_input: ActionCreateInput | ExportCreateInput = Field(
        description="用户输入：ACTION 用 ActionCreateInput，EXPORT 用 ExportCreateInput",
    )
    spec_overrides: ActionSpecOverrides | None = Field(
        default=None,
        description="ACTION 高级项覆盖（帧数/FPS/循环），EXPORT 省略",
    )


class CardUpdateRequest(BaseModel):
    """更新卡片用户输入（不触发生成）。

    CHARACTER：更新 selected_candidate_id（选定候选）
    ACTION：更新描述等草稿
    """

    user_input: CharacterUpdateInput | ActionCreateInput | ExportCreateInput = Field(
        description="更新后的用户输入，结构按 card_type"
    )
    position_x: float | None = Field(default=None, description="画布 X 坐标（拖动后保存）")
    position_y: float | None = Field(default=None, description="画布 Y 坐标（拖动后保存）")


class CharacterConfirmRequest(BaseModel):
    """CHARACTER 卡片确认请求。"""

    card_type: Literal["character"] = "character"
    user_input: CharacterConfirmInput = Field(description="角色描述和候选图数量")
    spec_overrides: None = None  # CHARACTER 无高级项


class ActionConfirmRequest(BaseModel):
    """ACTION 卡片确认请求。"""

    card_type: Literal["action"] = "action"
    user_input: ActionCreateInput = Field(description="动作输入（可修改描述后确认）")
    spec_overrides: ActionSpecOverrides | None = Field(default=None, description="高级项覆盖")


class ExportConfirmRequest(BaseModel):
    """EXPORT 卡片确认请求。"""

    card_type: Literal["export"] = "export"
    user_input: ExportCreateInput = Field(description="导出格式和帧率")
    spec_overrides: None = None  # EXPORT 无高级项


# 前端按 card_type 选择对应的 ConfirmRequest 发送
CardConfirmRequest = CharacterConfirmRequest | ActionConfirmRequest | ExportConfirmRequest


class CardRegenerateRequest(BaseModel):
    """重新生成（创建新的 GenerationAttempt）。

    CHARACTER：旧 CANDIDATE 全部 INACTIVE，重新生成候选。ACTION/EXPORT 不受影响。
    ACTION / EXPORT：创建新 attempt，重新执行。
    """

    user_input: CharacterConfirmInput | ActionCreateInput | ExportCreateInput | None = Field(
        default=None,
        description="可选：修改输入后重新生成，省略则沿用上次输入",
    )


class CanvasCardOut(BaseModel):
    """卡片响应。

    user_input / latest_result 的结构按 card_type 不同，参考对应的 Pydantic 模型。
    """

    model_config = ConfigDict(from_attributes=True)

    id: int
    card_type: str = Field(description="character / candidate / action / export")
    status: str = Field(description="draft / generating / completed / failed / inactive")
    parent_card_id: int | None = None
    direction: str | None = Field(default=None, description="front / side / back / left / null")
    position_x: float = 0.0
    position_y: float = 0.0
    user_input: dict = Field(
        default_factory=dict,
        description="用户输入，结构按 card_type 见对应的 Input 模型",
    )
    latest_result: dict | None = Field(
        default=None,
        description="生成结果，结构按 card_type 见对应的 Result 模型",
    )
    spec_overrides: dict = Field(
        default_factory=dict,
        description="高级项覆盖，ACTION 用 ActionSpecOverrides 结构",
    )
    version: int = 1


# ══════════════════════════════════════════════════════════════════════════════
# 生成尝试
# ══════════════════════════════════════════════════════════════════════════════


class GenerationAttemptOut(BaseModel):
    """生成尝试响应。"""

    model_config = ConfigDict(from_attributes=True)

    id: int
    card_id: int
    task_id: int | None = Field(default=None, description="关联的 GenerationTask ID，可用于订阅 Task SSE")
    attempt_no: int = Field(description="第几次尝试，从 1 开始")
    status: str = Field(description="pending / running / completed / failed")
    input_payload: dict = Field(default_factory=dict, description="生成输入快照")
    result: dict | None = Field(default=None, description="生成结果")
    error_message: str | None = None
