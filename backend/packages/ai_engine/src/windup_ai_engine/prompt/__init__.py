"""prompt:各动作的生成提示词与装配。"""

from .actions import build_attack_prompt, build_idle_prompt
from .custom import MAX_ACTION_CHARS, build_custom_prompt
from .jump import JUMP_PHASES, build_jump_prompt
from .walk import build_walk_prompt

__all__ = [
    "build_walk_prompt",
    "JUMP_PHASES",
    "build_jump_prompt",
    "build_idle_prompt",
    "build_attack_prompt",
    "build_custom_prompt",
    "MAX_ACTION_CHARS",
]
