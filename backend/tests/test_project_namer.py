"""LangChain 项目起名器：项目标题与角色称呼使用不同提示词。"""

from types import SimpleNamespace

from windup_ai_engine.impl.project_namer import LangChainProjectNamer


class _FakeChat:
    def __init__(self, content):
        self.content = content
        self.messages = None

    def invoke(self, messages):
        self.messages = messages
        return SimpleNamespace(content=self.content)


def test_project_namer_requests_a_project_title_and_cleans_model_text():
    chat = _FakeChat('  "雾港守夜计划"  ')
    namer = LangChainProjectNamer(chat_model=chat)

    assert namer.name_from_description("一位提着风灯的像素守夜人") == "雾港守夜计划"
    assert "项目" in chat.messages[0].content
    assert "角色称呼" not in chat.messages[0].content


def test_project_namer_truncates_to_20_chars():
    namer = LangChainProjectNamer(chat_model=_FakeChat("风" * 25))

    assert namer.name_from_description("一段描述") == "风" * 20
