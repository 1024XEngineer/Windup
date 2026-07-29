"""共享 DTO —— 跨层契约(common,无内部依赖)。

产品核心实体的数据模型:角色卡(一致性主键)、动作规格、生成路线枚举。
仅定义结构,不含行为。ai_engine / app 均依赖此。
"""
from __future__ import annotations

from enum import Enum

from pydantic import BaseModel, Field


class ActionType(str, Enum):
    """动作类型 —— 决定走哪条生成 strategy(见 ai_engine.strategy.ROUTE_MATRIX)。"""

    IDLE = "idle"
    WALK = "walk"
    RUN = "run"
    JUMP = "jump"      # 一次性动作,且要按状态切段(见 postprocess.split_jump_phases)
    ATTACK = "attack"  # slash / thrust / dash 归此
    HIT = "hit"


class GenRoute(str, Enum):
    """生成路线 —— 实测挣得的分流依据(见 ai_engine.strategy 层 docstring)。

    **只列有实现的路线。** 没有实现的枚举值等于死代码:它会让调用方以为该能力存在,
    而分流到它只能得到运行时错误。未来路线(如三渲二渲染出帧)的契约需求记在 Issue 里
    (见 #81 #122),随实现一起加成员 —— 枚举加成员是纯加法,不构成破坏性变更。
    """

    VIDEO_I2V = "video_i2v"   # 步态位移动作:图生视频(连贯交替腿)
    PER_FRAME = "per_frame"   # 离散姿势:逐帧图生图(单帧可编辑)


class CharacterCard(BaseModel):
    """角色卡 —— 一致性主键 + 资产库基础(产品核心实体)。"""

    name: str
    desc: str                       # 身份描述(喂模型锁一致性)
    palette: str = ""
    view: str = "pseudo-side"       # side / topdown / isometric
    master_ref: str = ""            # 定妆母版的存储 ref(对象存储,非本地路径)
    version: str = "v1"


class ActionSpec(BaseModel):
    """动作规格 —— 帧数 / 帧率 / 循环模式 / 逐帧姿势 / 风格化。"""

    action: ActionType
    fps: int = 10
    loop: str = "linear"            # none / linear / pingpong
    poses: list[str] = Field(default_factory=list)
    # 风格化:pixel=像素化(原生像素角色 i2v 后复原像素感);none=保留 i2v 插画质感。
    # 不该焊死——插画风角色像素化会出不协调色块(有损近似);默认由 CharacterCard 画风决定。
    stylize: str = "pixel"          # pixel / none
    pixel_h: int = 100              # 像素化目标高(角色像素行数)
    palette_size: int = 32          # 色板色数
    # 生成提示词的朝向,**必须与母版朝向一致**(对应 Project.perspective):
    # side=横版侧走 / front=俯视·2.5D 朝观者。不一致会让模型靠转身调和图文矛盾。
    facing: str = "side"            # side / front

    @property
    def n_frames(self) -> int:
        return len(self.poses)
