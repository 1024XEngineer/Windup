"""四向 / 八向立绘 sheet 图生图提示词。

提示词正文在 ``prompts/view_sheet.md``。本模块只做加载与按方向 / 项目视角拼接。
身份锚是正视图(``south``);东 / 北 / 对角转相机;西 / 西北 / 西南生产路径翻转、不调模型。
"""

from __future__ import annotations

from windup_common.directions import ActionDirection
from windup_common.models import CharacterView

from windup_ai_engine.prompt._md import load_section

__all__ = [
    "VIEW_SHEET_PROMPT_VERSION",
    "build_oriented_first_frame_prompt",
    "build_view_sheet_prompt",
    "view_for_perspective",
]

_DOC = "view_sheet.md"
VIEW_SHEET_PROMPT_VERSION = "v1"

_PERSPECTIVE_TO_VIEW = {
    1: CharacterView.SIDE,
    2: CharacterView.TOP_DOWN,
    3: CharacterView.ISOMETRIC,
}


def view_for_perspective(perspective: int) -> CharacterView:
    """项目 ``character_perspective`` → 立绘 / 首帧用的仰角模板。"""
    return _PERSPECTIVE_TO_VIEW.get(perspective, CharacterView.SIDE)


def build_view_sheet_prompt(
    direction: ActionDirection | str,
    *,
    view: CharacterView | str = CharacterView.TOP_DOWN,
    extra: str = "",
) -> str:
    """拼一条从正视母版转出 ``direction`` 的图生图提示词。

    ``direction`` / ``view`` 都过一遍枚举构造:非法值要炸,不能静默落到某一朝向。
    ``extra`` 是调用方补的站姿或画风短句,可空;身份与机位以模板为准。
    """

    azimuth = ActionDirection(direction)
    perspective = CharacterView(view)
    parts = [
        load_section(_DOC, "identity"),
        load_section(_DOC, "pose"),
        load_section(_DOC, azimuth.value),
        load_section(_DOC, f"elevation.{perspective.value}"),
        load_section(_DOC, "framing"),
    ]
    extra_text = extra.strip()
    if extra_text:
        parts.append(extra_text)
    return " ".join(parts)


def build_oriented_first_frame_prompt(
    direction: ActionDirection | str,
    *,
    view: CharacterView | str = CharacterView.TOP_DOWN,
    action_prompt: str,
) -> str:
    """从正视母版锁相机方位,再换成动作首帧姿态。

    复用 sheet 的朝向 / 仰角 / 构图节;身份与姿态改成允许动,不能沿用 idle standing。
    ``action_prompt`` 必须有正文:空描述会让方位锁后面没有姿态,模型容易站着不动。
    """

    azimuth = ActionDirection(direction)
    perspective = CharacterView(view)
    action = action_prompt.strip()
    if not action:
        raise ValueError("动作首帧必须提供动作描述")
    return " ".join(
        [
            load_section(_DOC, "identity.first_frame"),
            load_section(_DOC, azimuth.value),
            load_section(_DOC, f"elevation.{perspective.value}"),
            load_section(_DOC, "framing"),
            load_section(_DOC, "first_frame.pose_lock"),
            action,
        ]
    )
