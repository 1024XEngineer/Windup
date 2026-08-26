"""待机 / 攻击 i2v 提示词。

提示词正文在 ``prompts/idle.md`` 与 ``prompts/attack.md``(#233)。
本模块只留加载与按 facing / archetype 分流。
"""
from __future__ import annotations

from windup_common.models import AttackArchetype, Facing

from windup_ai_engine.prompt._framing import with_framing
from windup_ai_engine.prompt._md import load_section

__all__ = ["build_idle_prompt", "build_attack_prompt"]


def build_idle_prompt(facing: Facing | str = Facing.SIDE) -> str:
    """待机正文(循环类)。``facing`` 须与母版朝向一致。

    """
    return with_framing(load_section("idle.md", Facing(facing).value))


def build_attack_prompt(
    facing: Facing | str = Facing.SIDE,
    *,
    archetype: AttackArchetype | str = AttackArchetype.THRUST,
) -> str:
    """攻击正文(一次性类)。``facing`` 须与母版朝向一致。

    默认取 THRUST:四支里只有 SWEEP 要求手里有一件有宽面的长条物,拿它当默认 = 对每个未知角色断言持械(#195)。
    """
    # 两个枚举都过一遍构造:非法值要炸,不能静默落到某一节。
    section = f"{AttackArchetype(archetype).value}.{Facing(facing).value}"
    return with_framing(load_section("attack.md", section))
