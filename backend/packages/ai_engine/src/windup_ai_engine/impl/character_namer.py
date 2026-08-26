"""用 LangChain Chat 模型从角色描述抽出短名称。"""

from __future__ import annotations

from typing import Any

from langchain_core.messages import HumanMessage, SystemMessage

from windup_framework.providers import create_chat_model

NAME_MAX_LEN = 20

_SYSTEM_PROMPT = (
    "你从角色外观或人设描述中抽出一个适合资产库展示的称呼。"
    "只输出名称本身，不要引号、标点或解释。"
    f"名称不超过 {NAME_MAX_LEN} 个字，优先中文。"
)


def _clean_name(raw: str) -> str:
    return raw.strip().strip("\"'“”‘’").strip()[:NAME_MAX_LEN]


class LangChainCharacterNamer:
    """``CharacterNamerPort`` 的 LangChain 实现。"""

    def __init__(self, chat_model: Any | None = None) -> None:
        # 装配期不创建 ChatOpenAI：CI / 本地无 AI_API_KEY 时 create_app 仍能起来。
        self._model = chat_model

    def _chat_model(self) -> Any:
        if self._model is None:
            self._model = create_chat_model()
        return self._model

    def name_from_description(self, description: str) -> str:
        result = self._chat_model().invoke(
            [
                SystemMessage(content=_SYSTEM_PROMPT),
                HumanMessage(content=description),
            ]
        )
        content = getattr(result, "content", result)
        if not isinstance(content, str):
            content = str(content or "")
        return _clean_name(content)
