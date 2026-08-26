"""四向 / 八向立绘 sheet 图生图提示词。

提示词正文在 ``prompts/view_sheet.md``。本模块只做加载与按方向 / 项目视角拼接。
身份锚是正视图(``south``);东 / 北 / 对角转相机;西 / 西北 / 西南生产路径翻转、不调模型。
"""

from __future__ import annotations

from windup_common.directions import ActionDirection
from windup_common.models import CharacterView

from windup_ai_engine.prompt._md import load_section

__all__ = ["VIEW_SHEET_PROMPT_VERSION", "build_view_sheet_prompt"]

_DOC = "view_sheet.md"
VIEW_SHEET_PROMPT_VERSION = "v1"


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
