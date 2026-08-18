"""跳跃 i2v 提示词(一次性动作,非循环)。

提示词正文在 ``prompts/jump.md``(#233)。本模块只留状态表、加载与分流。
"""
from __future__ import annotations

from windup_common.models import Facing

from windup_ai_engine.prompt._framing import with_framing
from windup_ai_engine.prompt._md import load_section

__all__ = ["JUMP_PHASES", "build_jump_prompt"]

_DOC = "jump.md"

# 顺序即时间顺序。
JUMP_PHASES = ("crouch", "rise", "apex", "fall", "land")


def build_jump_prompt(facing: Facing | str = Facing.SIDE) -> str:
    """按母版朝向生成跳跃正文。

    Args:
        facing: :class:`Facing` 成员(或其等价字符串),**必须与母版朝向一致**。

    """
    return with_framing(load_section(_DOC, Facing(facing).value))
