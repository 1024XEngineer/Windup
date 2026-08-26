"""用 LangChain Chat 模型从创作描述中提取项目标题。"""

from __future__ import annotations

from typing import Any

from langchain_core.messages import HumanMessage, SystemMessage

from windup_framework.providers import create_chat_model

NAME_MAX_LEN = 20

_SYSTEM_PROMPT = (
    "你根据角色创作描述拟一个适合项目列表展示的项目标题。"
    "标题要概括作品主题或资产集合，不要照抄完整外观描述，也不要只把具体人物名字当标题。"
    "只输出标题本身，不要引号、标点或解释。"
    f"标题不超过 {NAME_MAX_LEN} 个字，优先中文。"
)


def _clean_name(raw: str) -> str:
    return raw.strip().strip("\"'“”‘’").strip()[:NAME_MAX_LEN]


class LangChainProjectNamer:
    """项目起名器的 LangChain 实现；与角色命名共享模型接入，不共享 Prompt。"""

    def __init__(self, chat_model: Any | None = None) -> None:
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
