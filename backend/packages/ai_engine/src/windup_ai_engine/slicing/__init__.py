"""slicing:视频 → 帧序列。抽帧(extract)+ 选帧(周期 loop / 一次性 oneshot)。

视频路线里"从连续视频里挑出交付用的那几帧"这一步:循环类动作抽单步态周期(无缝
loop),一次性动作裁动作区间。像素化 / 对齐 / 打包在 :mod:`..postprocess`。

:mod:`.quality` 原本纯做诊断,现在还兼一份出参职责:交付帧的成色读数
(``motion_scale`` / ``dead_frame_indices`` / ``loop_seam`` / ``limb_motion``)汇成
``ports.ActionQuality``。
注意它**仍然不参与选帧** —— 那条消融结论没变,见 :func:`.loop.pick_cycle`。
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
from .quality import dead_frame_indices, limb_motion, loop_seam, motion_scale

__all__ = [
    "extract_frames_bytes",
    "extract_all_frames_bytes",
    "find_period",
    "pick_cycle",
    # 交付成色的四个读数(汇成 ports.ActionQuality;其余 quality.* 仍是内部诊断)
    "dead_frame_indices",
    "limb_motion",
    "loop_seam",
    "motion_scale",
    "find_motion_span",
    "first_action_end",
    "foot_line_series",
    "pick_oneshot",
    "split_jump_phases",
]
