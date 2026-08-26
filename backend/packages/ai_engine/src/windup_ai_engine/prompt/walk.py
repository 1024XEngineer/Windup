"""走路 i2v 提示词(视频路线)。

提示词正文在 ``prompts/walk.md``(#233),本模块只留加载与按 facing 分流。
措辞经过校准,**逐字改动前先查内部实验记录**。
"""
from __future__ import annotations

from windup_common.models import Facing

from windup_ai_engine.prompt._framing import with_framing
from windup_ai_engine.prompt._md import load_section

__all__ = ["build_walk_prompt"]

_DOC = "walk.md"

def build_walk_prompt(facing: Facing | str = Facing.SIDE) -> str:
    """按母版朝向生成走路正文。

    Args:
        facing: :class:`Facing` 成员(或其等价字符串)。**必须与母版朝向一致**,
            否则模型会靠转身调和矛盾。

    """
    # 过一遍 Facing() 构造:非法值要炸,不能静默落到某个模板。
    return with_framing(load_section(_DOC, Facing(facing).value))
