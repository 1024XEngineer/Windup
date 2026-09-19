"""写死的动作不许静默丢掉用户写的那句细节(#838)。

前端把用户的一句自由文本拆成两半发过来:``action_type`` 选哪条已调好的管线,
``custom_prompt`` 说这次具体要什么(quick-start planner 的提示词原文:"让生成复用
已有优化管线"+"必须把动作单独写入 actionPrompt")。后端原先只读前一半 —— 后一半
进了 ``CharacterCard.desc``,而视频路线**不读** desc(那条注释自己写着"角色身份由母版
图像承载"),于是用户写的东西一个字都没进提示词。

而任务照常成功、照常扣费、帧数时长成色全对,唯一能察觉的方式是看产物。生产实测
**124/124 条非 custom 任务全中**:

    #564  attack  "炸开，分裂成非常多只小型蓝色史莱姆"  → 出片是个金发人形武者
    #391  attack  "施法：角色保持原地站立"              → 给的是弓步突刺模板
    walk          "奔跑" / "原地行走循环，不向前位移"   → 都出了同一套通用走路
    idle          "一只小狗低头在饭碗里吃饭"            → 出了通用呼吸待机
    jump          "螃蟹原地快速左右摆动，挥舞双钳"      → 出了通用腾空跳

下面每条对应其中一个真实坏例。
"""
from __future__ import annotations

import pytest
from pydantic import ValidationError

from windup_ai_engine.prompt import (
    build_attack_prompt,
    build_idle_prompt,
    build_jump_prompt,
    build_walk_prompt,
)
from windup_ai_engine.prompt._framing import SINGLE_SUBJECT_FRAMING
from windup_ai_engine.strategy.concrete import VideoFrameStrategy
from windup_common.models import (
    ActionSpec,
    ActionType,
    AttackArchetype,
    CharacterStance,
    Facing,
)

# #564 的原文。中文样本才走得到真实链路(适配器按中文写的)。
SLIME_BURST = "炸开，分裂成非常多只小型蓝色史莱姆，许多小史莱姆漂浮在空中并发光。"
DOG_EATING = "一只小狗低头在饭碗里吃饭，前爪支撑身体，持续舔食或咀嚼。"

TEMPLATED = [
    (ActionType.WALK, build_walk_prompt),
    (ActionType.IDLE, build_idle_prompt),
    (ActionType.JUMP, build_jump_prompt),
    (ActionType.ATTACK, build_attack_prompt),
]


def _strat() -> VideoFrameStrategy:
    return VideoFrameStrategy(video=None, matte=None)


def _prompt(action: ActionType, *, detail: str | None = None) -> str:
    spec = ActionSpec(action=action, facing=Facing.SIDE, detail=detail)
    return _strat()._build_prompt(spec, CharacterStance.BIPED)


# ── ① 用户那句话必须进提示词 ─────────────────────────────────────────────


@pytest.mark.parametrize("action,builder", TEMPLATED, ids=lambda v: getattr(v, "value", ""))
def test_the_users_clause_changes_the_prompt(action, builder):
    """判据是"和不带细节时不一样"。

    只断言"包含某个关键词"会被"把中文原样贴在末尾"骗过,而那样贴会破坏构图约束的
    收口位置(见下一条);只断言"不等于模板"才说明它真的进去了。
    """
    assert _prompt(action, detail=DOG_EATING) != _prompt(action)


@pytest.mark.parametrize("action,_b", TEMPLATED, ids=lambda v: getattr(v, "value", ""))
def test_the_clause_sits_before_the_framing_constraints(action, _b):
    """构图约束必须仍是最后一句。

    ``_framing`` 那份注释把它定成收口句,提示词适配器的契约靠它确认公共约束没被绕过。
    细节贴在它后面 = 悄悄废掉那道契约检查。
    """
    text = _prompt(action, detail=DOG_EATING)
    assert text.rstrip().endswith(SINGLE_SUBJECT_FRAMING), text[-160:]


def test_the_template_survives_alongside_the_clause():
    """叠加,不是二选一。

    模板定运动拓扑(走路要腿交替)—— 那正是前端把这句话分类到 walk 的理由。
    拿细节替换模板等于把这次生成降级成 custom,腿不交替的老毛病会回来(#221)。
    """
    text = _prompt(ActionType.WALK, detail=DOG_EATING)
    plain = _prompt(ActionType.WALK)
    # 模板正文整段仍在(去掉方向锁后 plain 的正文是 text 的前缀)。
    core = plain.split(SINGLE_SUBJECT_FRAMING)[0].strip()
    assert core.split("Preserve the reference")[0].strip() in text


def test_attack_keeps_its_archetype_and_still_takes_the_clause():
    """#564:攻击这一支要按运动拓扑选模板,不能因为加了细节就绕过 archetype。"""
    spec = ActionSpec(
        action=ActionType.ATTACK,
        facing=Facing.SIDE,
        archetype=AttackArchetype.SWEEP,
        detail=SLIME_BURST,
    )
    got = _strat()._build_prompt(spec, CharacterStance.BIPED)
    assert got != build_attack_prompt(facing=Facing.SIDE, archetype=AttackArchetype.SWEEP)
    assert got != _prompt(ActionType.ATTACK, detail=SLIME_BURST)  # 缺省支是 THRUST


# ── ② 空白不算填写 ───────────────────────────────────────────────────────


@pytest.mark.parametrize("blank", [None, "", "   ", "\n\t "])
@pytest.mark.parametrize("action,builder", TEMPLATED, ids=lambda v: getattr(v, "value", ""))
def test_a_blank_clause_leaves_the_prompt_byte_identical(action, builder, blank):
    """绝大多数存量任务这里是空的,行为必须一个字节不变。"""
    assert _prompt(action, detail=blank) == _prompt(action)


# ── ③ 契约层:custom 不该同时有两份描述 ───────────────────────────────────


def test_custom_may_not_also_carry_a_detail_clause():
    """custom 没有模板可叠,动作内容整条走 custom_action。

    两个字段都填会让同一段描述进两次提示词。
    """
    with pytest.raises(ValidationError):
        ActionSpec(
            action=ActionType.CUSTOM,
            custom_action=SLIME_BURST,
            cyclic=False,
            detail=SLIME_BURST,
        )


# ── ④ 非双足角色写人体部位仍然要拒 ───────────────────────────────────────


def test_a_body_part_clause_on_a_limbless_character_is_rejected_not_silently_drawn():
    """细节句必须和 custom 那条路走同一道门禁。

    绕过适配器直接把"手臂"喂给无肢角色,模型会凭空接上一对人的上肢 ——
    而帧数、时长、成色全部正常,没有一道会红。
    """
    from windup_ai_engine.ports import PromptRejected

    spec = ActionSpec(
        action=ActionType.WALK,
        facing=Facing.SIDE,
        detail="角色挥动双臂，手肘弯曲。",
    )
    with pytest.raises(PromptRejected):
        _strat()._build_prompt(spec, CharacterStance.SERPENTINE)
