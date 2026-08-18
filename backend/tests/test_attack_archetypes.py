"""攻击提示词按运动拓扑分支 + 全动作统一构图约束。

这一片锁的是 #195 的**形状层**残留:名词清干净了,`crescent arc` / `broad side` 这类
形状短语仍在断言"手里有一件有宽面的长条物"。喂法杖 / 空手 / 四足角色时,模型调和图文
矛盾最省力的解法就是凭空补出那件东西 —— 而帧数、时长、成色全部正常,没有一道会红。
"""
from __future__ import annotations

import itertools

import pytest
from pydantic import ValidationError

from windup_ai_engine.master_prep import ATTACK_MASTER_POSES
from windup_ai_engine.prompt import (
    build_attack_prompt,
    build_custom_prompt,
    build_idle_prompt,
    build_jump_prompt,
    build_walk_prompt,
)
from windup_ai_engine.prompt._framing import SINGLE_SUBJECT_FRAMING
from windup_ai_engine.strategy.concrete import VideoFrameStrategy
from windup_common.models import ActionSpec, ActionType, AttackArchetype, Facing

FACINGS = (Facing.SIDE, Facing.FRONT)
COMBOS = list(itertools.product(AttackArchetype, FACINGS))

# 装备名词(#195)+ 形状短语(本片)。后者不点名任何物件,却同样断言了它的几何。
_SHAPE_PRIORS = (
    "sword", "blade", "staff", "wand", "weapon", "claw", "fist",
    "broad side", "crescent", "long edge", "flat of the",
)

# 远程支不许写接触弧:写"挥过去 / 划过去"就是在逼模型造一个被打的对象。
_CONTACT_ARC = ("sweep", "swing", "arc", "slash", "across the front", "connects with")

# 整体位移词。i2v 强跟身体、弱跟持物,只写持物动作会让它自行漂移。
_WHOLE_BODY = ("whole body", "torso", "hips", "lunge")


def _hits(text: str, words) -> list[str]:
    low = text.lower()
    return [w for w in words if w in low]


# ── ① 八种组合都取得到,且互不相同 ────────────────────────────────────────


@pytest.mark.parametrize("archetype,facing", COMBOS)
def test_every_archetype_and_facing_resolves_to_real_text(archetype, facing):
    text = build_attack_prompt(facing=facing, archetype=archetype)
    assert len(text) > 200, f"{archetype.value}.{facing.value} 短得不像正文:{text!r}"


def test_the_eight_combinations_are_all_distinct():
    """任意两支撞车 = 有一支没写、静默复用了别支的运动拓扑。"""
    texts = [build_attack_prompt(facing=f, archetype=a) for a, f in COMBOS]
    assert len(set(texts)) == len(COMBOS)


def test_illegal_archetype_raises_instead_of_falling_back():
    with pytest.raises(ValueError):
        build_attack_prompt(facing=Facing.SIDE, archetype="sweeping")


# ── ② 四支都不带装备形状先验 ─────────────────────────────────────────────


@pytest.mark.parametrize("archetype,facing", COMBOS)
def test_no_branch_asserts_a_held_shape(archetype, facing):
    named = _hits(build_attack_prompt(facing=facing, archetype=archetype), _SHAPE_PRIORS)
    assert not named, f"{archetype.value}.{facing.value} 断言了持物形状: {named}"


@pytest.mark.parametrize("archetype,facing", COMBOS)
def test_the_striking_subject_is_a_body_part_not_an_arm(archetype, facing):
    """主语写"手臂"= 断言角色有手臂,四足角色没有。"""
    low = build_attack_prompt(facing=facing, archetype=archetype).lower()
    assert "arm" not in low.replace("armour", "").replace("armor", ""), \
        f"{archetype.value}.{facing.value} 把发力主语写成了手臂"


@pytest.mark.parametrize("archetype,facing", COMBOS)
def test_every_branch_moves_the_whole_body(archetype, facing):
    text = build_attack_prompt(facing=facing, archetype=archetype)
    assert _hits(text, _WHOLE_BODY), \
        f"{archetype.value}.{facing.value} 只写了肢体动作,没写身体整体位移"


@pytest.mark.parametrize("facing", FACINGS)
def test_ranged_branch_describes_no_contact_arc(facing):
    """远程支写"挥过去"= 逼模型在画面里造一个被打的对象。"""
    text = build_attack_prompt(facing=facing, archetype=AttackArchetype.PROJECT)
    assert not _hits(text, _CONTACT_ARC), f"project.{facing.value} 写了接触弧: {_hits(text, _CONTACT_ARC)}"


def test_the_contact_arc_check_would_catch_a_real_swing():
    """反向校准:这组词在近战支上确实会命中,否则上一条恒真、什么也没测。"""
    swept = build_attack_prompt(facing=Facing.SIDE, archetype=AttackArchetype.SWEEP)
    assert _hits(swept, _CONTACT_ARC)


# ── ③ 默认支必须是 THRUST ────────────────────────────────────────────────


def test_default_archetype_is_thrust_not_sweep():
    """SWEEP 是唯一要求"手里有一件有宽面长条物"的一支;拿它当默认 = 对每个未知角色断言持械。"""
    assert build_attack_prompt() == build_attack_prompt(archetype=AttackArchetype.THRUST)
    assert build_attack_prompt() != build_attack_prompt(archetype=AttackArchetype.SWEEP)


# ── ④ ActionSpec 契约:archetype 只属于 attack ────────────────────────────


@pytest.mark.parametrize(
    "action", [a for a in ActionType if a is not ActionType.ATTACK and a is not ActionType.CUSTOM]
)
def test_non_attack_actions_must_not_carry_an_archetype(action):
    with pytest.raises(ValidationError, match="archetype"):
        ActionSpec(action=action, archetype=AttackArchetype.SWEEP)


def test_custom_action_must_not_carry_an_archetype_either():
    with pytest.raises(ValidationError, match="archetype"):
        ActionSpec(
            action=ActionType.CUSTOM, custom_action="waves", cyclic=False,
            archetype=AttackArchetype.SWEEP,
        )


def test_attack_takes_an_archetype_and_defaults_to_unspecified():
    """不指定就是 None:缺省只由 build_attack_prompt 定义一次,契约层不兜第二份。"""
    assert ActionSpec(action=ActionType.ATTACK).archetype is None
    assert ActionSpec(
        action=ActionType.ATTACK, archetype=AttackArchetype.LUNGE
    ).archetype is AttackArchetype.LUNGE


# ── ⑤ 派生层真的把 archetype 传下去了 ────────────────────────────────────


@pytest.mark.parametrize("archetype", list(AttackArchetype))
def test_strategy_builds_the_prompt_of_the_requested_archetype(archetype):
    """契约字段填了却没人读,是本项目最典型的静默失败(见 ActionSpec.fps 那段)。"""
    strat = VideoFrameStrategy(video=None, matte=None)
    spec = ActionSpec(action=ActionType.ATTACK, archetype=archetype, facing=Facing.FRONT)
    assert strat._build_prompt(spec) == build_attack_prompt(
        facing=Facing.FRONT, archetype=archetype
    )


def test_strategy_without_an_archetype_falls_back_to_the_builder_default():
    strat = VideoFrameStrategy(video=None, matte=None)
    spec = ActionSpec(action=ActionType.ATTACK, facing=Facing.SIDE)
    assert strat._build_prompt(spec) == build_attack_prompt(facing=Facing.SIDE)


# ── ⑥ 统一构图后缀:五个动作都要带 ───────────────────────────────────────


def _all_prompts() -> dict[str, str]:
    out: dict[str, str] = {}
    for facing in FACINGS:
        out[f"walk.{facing.value}"] = build_walk_prompt(facing=facing)
        out[f"jump.{facing.value}"] = build_jump_prompt(facing=facing)
        out[f"idle.{facing.value}"] = build_idle_prompt(facing=facing)
        out[f"custom.{facing.value}"] = build_custom_prompt(
            "waves the right hand", facing=facing, cyclic=False
        )
        for archetype in AttackArchetype:
            out[f"attack.{archetype.value}.{facing.value}"] = build_attack_prompt(
                facing=facing, archetype=archetype
            )
    return out


def test_every_action_prompt_carries_the_framing_clause():
    """attack 是唯一没有构图约束的动作,而它恰恰有两处留白(母版姿态要留白 + 母版补边)。"""
    missing = [k for k, v in _all_prompts().items() if SINGLE_SUBJECT_FRAMING not in v]
    assert not missing, f"这些提示词没带构图约束: {missing}"


def test_the_framing_clause_is_appended_by_code_not_copied_into_the_markdown():
    """抄进每份 md 会各自漂移;md 正文里出现它就说明有人开始抄了。"""
    from windup_ai_engine.prompt._md import load_doc

    for doc in ("walk.md", "jump.md", "idle.md", "attack.md"):
        for section, text in load_doc(doc).items():
            assert "exactly one character" not in text.lower(), \
                f"{doc} 的 {section} 把构图句抄进了 md"


def test_the_framing_clause_counts_positively_instead_of_forbidding():
    """该接口没有 negative_prompt:否定句里的名词会被 latch 进画面。"""
    low = SINGLE_SUBJECT_FRAMING.lower()
    assert "exactly one character" in low
    hits = [w for w in (" not ", " no ", "n't", "without", "avoid", "never", "只") if w in low]
    assert not hits, f"构图句写成了否定式: {hits}"


# ── ⑦ 母版姿态的四支同样不带形状先验 ─────────────────────────────────────


@pytest.mark.parametrize("archetype", list(AttackArchetype))
def test_attack_master_poses_carry_no_shape_prior(archetype):
    """母版是整条 i2v 链的身份来源,污染会一路带到所有动作。"""
    named = _hits(ATTACK_MASTER_POSES[archetype], _SHAPE_PRIORS)
    assert not named, f"attack.{archetype.value} 的母版姿态断言了持物形状: {named}"
