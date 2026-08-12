"""DerivationStrategy —— 按动作类型分流到生成路线(本营实测挣得的核心架构决策)。

分流依据(有实测证据,非拍脑袋,详见关联 Issue #35 的工程文档):
  - 步态位移(walk / run):逐帧独立生成锁不住"哪条腿在前" → 踢踏舞;
    必须走视频 i2v(视频模型天生连贯、腿自然交替)。
  - 动作爆发(attack)与跳跃(jump):同走视频 i2v。但它们是**一次性动作**,抽帧不闭环
    (见本模块 CYCLIC_ACTIONS);jump 还要按状态切段供引擎分段播放。
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
    # idle 走 i2v(build_idle_prompt:躯干缓慢起伏呼吸)。
    # **2026-08-07 定案**:#53 原设计的 ¥0 程序化 Idle-B(局部网格呼吸)放弃 —— 做不出
    # 可用效果,idle 认这份 i2v 的钱。GenRoute.PROC_IDLE 与 ProcIdleStrategy 已一并移除。
    ActionType.IDLE: GenRoute.VIDEO_I2V,
}

# 循环类动作:抽单步态周期闭环。一次性动作**不能闭环**(首尾姿态不同,强行闭环会把
# 落地帧接回蓄力帧=抽搐),走"裁动作区间 + 区间内均匀取"。
# 与 ROUTE_MATRIX 并排放在 base 而不是留在 concrete:它同样是「动作类型 → 产线行为」的
# 契约,且现在有两个消费方 —— strategy.concrete 用它选抽帧方式,impl.CharacterGenerator
# 用它决定交付成色里的 loop_seam 该不该测(不闭环的动作没有"接缝"可言)。放在 concrete
# 会让 generator 为了问一句"这动作循环吗"去 import 一条具体路线的实现。
CYCLIC_ACTIONS: frozenset[ActionType] = frozenset(
    {ActionType.IDLE, ActionType.WALK, ActionType.RUN}
)

# 本矩阵的形状本身有个已知边界,记录在此以免后来者按错误前提扩展:
# 它是「动作类型 → 路线」的一对一映射,隐含前提是"路线由动作的物理性质唯一决定"。
# 该前提对逐帧 / 视频两条路线成立(有无连续步态是动作固有属性),但对渲染出帧路线不成立
# —— 同一个 walk 既可走 i2v 也可走渲染,选哪条取决于"该角色有没有 3D 模型",那是 server
# 才知道的事。接入第三条路线前须先定「路线选择由谁决定」,并可能要把本矩阵改成
# 「动作类型 → 可选路线集合」+ 一个选择器。Refs 1024XEngineer/Windup#81 #122。


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
