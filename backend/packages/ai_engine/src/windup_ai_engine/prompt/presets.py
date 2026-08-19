"""动作预设 —— 菜单里那几个动作的展示名与默认描述。

**这里是唯一真相源。** 这段描述会随请求同时进到两条付费通路:动作母版那张静态图
(``/generation/image`` 的 ``prompt``)与 i2v(``custom_prompt``)。写在前端的副本既会
与后端漂移,又整条绕开 :mod:`windup_ai_engine.prompt.lint` 的措辞门禁。

描述只说"这一瞬间身体是什么样",不写时间阶段:静态模型收到多阶段描述会把各阶段并排
画成一张分解姿势图,画面里于是有多个人物,i2v 再把他们一起带进成品
(Refs 1024XEngineer/Windup#309)。
"""
from __future__ import annotations

from dataclasses import dataclass

from windup_common.models import ActionType

__all__ = ["ActionPreset", "ACTION_PRESETS"]


@dataclass(frozen=True)
class ActionPreset:
    """``label`` 只用于菜单展示,``name`` 落进 WorkflowRun —— 分开存放,改菜单文案不会
    连带改掉已经落库的动作名。
    """

    type: ActionType
    label: str
    name: str
    description: str


ACTION_PRESETS: tuple[ActionPreset, ...] = (
    # 只写机制(什么在动),不写幅度:"轻微 / 细微"这类词要求的位移低于模型可控的分辨率,
    # 拿到的不是小幅起伏而是逐帧随机抖动(lint 规则 2a)。
    ActionPreset(
        type=ActionType.IDLE,
        label="Idle 待机",
        name="待机",
        description="呼吸带动胸腔起伏,重心随之上下移动",
    ),
    ActionPreset(
        type=ActionType.WALK,
        label="Walk 行走",
        name="行走",
        description="轻快地向前行走",
    ),
    # 取蓄势的那一瞬,与 ``prompts/master_poses.md`` 的 ``attack.thrust`` 同一时刻 ——
    # 母版姿态决定动作,提示词只能微调,两处描述的不是同一瞬间时模型会先把姿势重摆一遍。
    ActionPreset(
        type=ActionType.ATTACK,
        label="Attack 攻击",
        name="攻击",
        description="直刺发力前的蓄势瞬间,重心沉在后脚,出击的一侧收在腰际",
    ),
)
