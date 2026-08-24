"""画风预设领域。

预设本身住在 ai_engine 里 —— 它的短语归提示词门禁管。本模块只是分层链上的一站:
web 层不得直连 ai_engine(见 pyproject 的 import-linter 契约②)。
"""

from windup_ai_engine.prompt import ART_STYLE_PRESETS, ArtStylePreset

__all__ = ["ART_STYLE_PRESETS", "ArtStylePreset"]
