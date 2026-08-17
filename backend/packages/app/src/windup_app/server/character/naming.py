"""创建角色时解析最终名称：用户输入优先，否则 LLM，再否则描述兜底。"""

from __future__ import annotations

from typing import Protocol

NAME_MAX_LEN = 20
FALLBACK_NAME = "未命名角色"


class CharacterNamer(Protocol):
    """server 侧起名器契约，避免 web→service 链路碰到 ai_engine。"""

    def name_from_description(self, description: str) -> str: ...


def _clip(value: str) -> str:
    return value[:NAME_MAX_LEN]


def resolve_character_name(
    name: str | None,
    description: str | None,
    namer: CharacterNamer | None = None,
) -> str:
    """把可空的 name / description 收成入库用的非空短名称。"""
    cleaned_name = (name or "").strip()
    if cleaned_name:
        return _clip(cleaned_name)

    cleaned_description = (description or "").strip()
    if cleaned_description and namer is not None:
        try:
            generated = (namer.name_from_description(cleaned_description) or "").strip()
        except Exception:
            generated = ""
        if generated:
            return _clip(generated)

    if cleaned_description:
        return _clip(cleaned_description)
    return FALLBACK_NAME
