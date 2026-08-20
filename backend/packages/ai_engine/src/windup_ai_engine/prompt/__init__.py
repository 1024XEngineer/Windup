"""prompt:各动作的生成提示词与装配。"""

from .actions import build_attack_prompt, build_idle_prompt
from .custom import MAX_ACTION_CHARS, build_custom_prompt
from .jump import JUMP_PHASES, build_jump_prompt
from .presets import ACTION_PRESETS, ActionPreset
from .walk import build_walk_prompt

# 改动本包任何一个 build_*_prompt 的输出(包括 prompts/*.md 模板)都必须连带把这个
# 常量加一:落库的 GeneratedAction.prompt_version 就靠它,分不清新旧模板的产出，
# 改完提示词也没法与改前的成色对比。
PROMPT_VERSION = "v1"

__all__ = [
    "build_walk_prompt",
    "JUMP_PHASES",
    "build_jump_prompt",
    "build_idle_prompt",
    "build_attack_prompt",
    "build_custom_prompt",
    "MAX_ACTION_CHARS",
    "ACTION_PRESETS",
    "ActionPreset",
    "PROMPT_VERSION",
]
