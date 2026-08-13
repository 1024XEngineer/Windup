"""跳跃 i2v 提示词(一次性动作,非循环)。

**正文与实测理由都在 ``prompts/jump.md``**(#233)。本模块只留状态表、加载与分流。
"""
from __future__ import annotations

from windup_common.models import Facing

from windup_ai_engine.prompt._md import load_section

__all__ = ["JUMP_PHASES", "build_jump_prompt"]

_DOC = "jump.md"

# 跳跃的五个状态(引擎侧按这个切段;顺序即时间顺序)。
# **留在 Python**:它是被代码索引的结构,不是送给模型的文本,搬进 md 只会多一层解析。
JUMP_PHASES = ("crouch", "rise", "apex", "fall", "land")


# 注:曾有 JUMP_BODY_SIDE / JUMP_BODY_FRONT 两个常量。随 #233 删除 —— 它们零消费方
# (prompt/__init__ 从没导出过,全仓无引用),正文现在只经 build_jump_prompt 出去。


def build_jump_prompt(facing: Facing | str = Facing.SIDE) -> str:
    """按母版朝向生成跳跃正文。

    Args:
        facing: :class:`Facing` 成员(或其等价字符串),**必须与母版朝向一致**。

    注:``garment`` / ``feet`` 两个装备参数随 #195 删除,理由见 ``prompts/walk.md``。
    """
    # 非法值在此炸掉,别静默落到 FRONT 模板(理由见 walk.py 同处注释)。
    return load_section(_DOC, Facing(facing).value)
