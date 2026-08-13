"""待机 / 攻击 i2v 提示词。

提示词正文在 ``prompts/idle.md`` 与 ``prompts/attack.md``(#233)。
本模块只留加载与按 facing 分流。
"""
from __future__ import annotations

from windup_common.models import Facing

from windup_ai_engine.prompt._md import load_section

__all__ = ["build_idle_prompt", "build_attack_prompt"]


def build_idle_prompt(facing: Facing | str = Facing.SIDE) -> str:
    """待机正文(循环类)。``facing`` 须与母版朝向一致。

    """
    return load_section("idle.md", Facing(facing).value)


def build_attack_prompt(facing: Facing | str = Facing.SIDE) -> str:
    """攻击正文(一次性类)。``facing`` 须与母版朝向一致。

    """
    return load_section("attack.md", Facing(facing).value)
