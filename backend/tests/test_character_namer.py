"""LangChain 角色起名器：注入假 chat model，不打真实 LLM。"""

from types import SimpleNamespace

from windup_ai_engine.impl.character_namer import LangChainCharacterNamer


class _FakeChat:
    def __init__(self, content: object, error: Exception | None = None) -> None:
        self.content = content
        self.error = error
        self.messages = None

    def invoke(self, messages):
        self.messages = messages
        if self.error is not None:
            raise self.error
        return SimpleNamespace(content=self.content)


def test_namer_returns_cleaned_model_text():
    chat = _FakeChat('  "赤发旅人"  ')
    namer = LangChainCharacterNamer(chat_model=chat)

    assert namer.name_from_description("红发少年站在雾港") == "赤发旅人"
    assert chat.messages is not None


def test_namer_truncates_to_20_chars():
    chat = _FakeChat("风" * 25)
    namer = LangChainCharacterNamer(chat_model=chat)
    assert namer.name_from_description("一段描述") == "风" * 20


def test_namer_construction_does_not_touch_chat_provider():
    """装配应用时不能因为没有 AI_API_KEY 就炸。"""
    namer = LangChainCharacterNamer()
    assert namer._model is None
