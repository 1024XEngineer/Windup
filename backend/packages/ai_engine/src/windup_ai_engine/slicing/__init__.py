"""slicing:视频 → 帧序列。抽帧(extract)+ 选帧(周期 loop / 一次性 oneshot)。

视频路线里"从连续视频里挑出交付用的那几帧"这一步:循环类动作抽单步态周期(无缝
loop),一次性动作裁动作区间。像素化 / 对齐 / 打包在 :mod:`..postprocess`。
"""

from .extract import extract_all_frames_bytes, extract_frames_bytes
from .loop import find_period, pick_cycle
from .oneshot import (
    find_motion_span,
    first_action_end,
    foot_line_series,
    pick_oneshot,
    split_jump_phases,
)

__all__ = [
    "extract_frames_bytes",
    "extract_all_frames_bytes",
    "find_period",
    "pick_cycle",
    "find_motion_span",
    "first_action_end",
    "foot_line_series",
    "pick_oneshot",
    "split_jump_phases",
]
