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
    "build_view_sheet_prompt",
    "master_pose_clause",
    "pixel_art_clause",
]

_DOC = "view_sheet.md"
VIEW_SHEET_PROMPT_VERSION = "v4"


def pixel_art_clause() -> str:
    """像素项目的网格 / 限色约束。定妆与 sheet 图生图共用,避免两处各写一版。"""
    return load_section(_DOC, "pixel")


def master_pose_clause() -> str:
    """定妆站立构图。sheet 图生图不拼这一节,身份与机位已在 identity / 朝向节。"""
    return load_section(_DOC, "master")


def build_view_sheet_prompt(
    direction: ActionDirection | str,
    *,
    view: CharacterView | str = CharacterView.TOP_DOWN,
    extra: str = "",
    stylize: str = "none",
    feedback: str = "",
) -> str:
    """拼一条从正视母版转出 ``direction`` 的图生图提示词。

    ``direction`` / ``view`` 都过一遍枚举构造:非法值要炸,不能静默落到某一朝向。
    ``extra`` 是调用方补的站姿或画风短句,可空;身份与机位以模板为准。
    ``stylize`` 为 ``pixel`` 时追加网格限色约束;项目画风短语仍不进这条提示词。
    ``feedback`` 是上一轮 QC 的英文修正,可空;拼在末尾,不替换身份 / 机位节。
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
    if stylize == "pixel":
        parts.append(pixel_art_clause())
    extra_text = extra.strip()
    if extra_text:
        parts.append(extra_text)
    feedback_text = feedback.strip()
    if feedback_text:
        parts.append(feedback_text)
    return " ".join(parts)
