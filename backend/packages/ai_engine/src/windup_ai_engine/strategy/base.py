"""DerivationStrategy —— 按动作类型分流到生成路线(本营实测挣得的核心架构决策)。

分流依据(有实测证据,非拍脑袋,详见关联 Issue #35 的工程文档):
  - 步态位移(walk / run):逐帧独立生成锁不住"哪条腿在前" → 踢踏舞;
    必须走视频 i2v(视频模型天生连贯、腿自然交替)。
  - 动作爆发(attack)与跳跃(jump):同走视频 i2v。但它们是**一次性动作**,抽帧不闭环
    (见 strategy.concrete.CYCLIC_ACTIONS);jump 还要按状态切段供引擎分段播放。
  - 受击等离散姿势(hit):逐帧图生图(单帧可编辑价值高,无连续步态)。
  - 待机(idle):逐帧生成只抖不呼吸 → 程序化局部呼吸 Idle-B。

ROUTE_MATRIX 是人主导的架构契约,改它=改产线,要有实测支撑。
"""
from __future__ import annotations

from abc import ABC, abstractmethod

from windup_common.models import ActionSpec, ActionType, CharacterCard, GenRoute

from windup_ai_engine.ports import ProgressPort

# 动作类型 → 生成路线(架构决策,写死为契约)
ROUTE_MATRIX: dict[ActionType, GenRoute] = {
    ActionType.WALK: GenRoute.VIDEO_I2V,
    ActionType.RUN: GenRoute.VIDEO_I2V,
    ActionType.JUMP: GenRoute.VIDEO_I2V,
    ActionType.ATTACK: GenRoute.VIDEO_I2V,
    ActionType.HIT: GenRoute.PER_FRAME,
    # idle 走 i2v(build_idle_prompt:躯干缓慢起伏呼吸)——"快速看着对"的待机路线。
    # ¥0 的程序化 Idle-B(局部网格呼吸)是后续可选优化,当前 ProcIdleStrategy 仍是桩。
    ActionType.IDLE: GenRoute.VIDEO_I2V,
}


class DerivationStrategy(ABC):
    """一条生成路线的骨架:母版 → 对齐前的角色帧序列。"""

    route: GenRoute

    @abstractmethod
    def derive(
        self,
        card: CharacterCard,
        action: ActionSpec,
        master: bytes,
        progress: ProgressPort,
    ) -> list[bytes]:
        """从母版 bytes 产出对齐前的角色帧(RGBA PNG bytes 列表)。"""
        raise NotImplementedError
