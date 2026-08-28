"""绑骨母版的图生图提示词。

提示词正文在 ``prompts/rig_master.md``。本模块只做加载。

**与定妆母版分开的理由**在 md 里写了:定妆母版还要给用户看、还要给图生视频当输入,
而 T-Pose 只对自动绑骨有意义。一张图兼顾两者的结果是两边都不到位 ——
实测线上产物臂展/身高 0.523,只比闸口下限 0.45 高 0.07,没够到 A-Pose 区间 0.55–0.75。
"""

from __future__ import annotations

from windup_ai_engine.prompt._md import load_section

__all__ = ["RIG_MASTER_PROMPT_VERSION", "build_rig_master_prompt"]

_DOC = "rig_master.md"
RIG_MASTER_PROMPT_VERSION = "v1"


def build_rig_master_prompt() -> str:
    """从定妆母版转出 T-Pose 绑骨母版的提示词。

    无参数:身份由附上的定妆母版携带,姿势与构图全部由模板锁死 ——
    留一个 ``extra`` 口子的话,调用方补进来的站姿描述会和 T-Pose 打架,
    而打架的结果是"手臂张开了一半",那正好落在闸口最难判的区间。
    """
    return load_section(_DOC, "tpose")
