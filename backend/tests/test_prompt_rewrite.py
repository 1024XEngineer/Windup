"""提示词 LLM 预改写层测试。"""
from __future__ import annotations

from types import SimpleNamespace

import pytest

from windup_ai_engine.prompt.lint import lint
from windup_ai_engine.prompt.rewrite import LlmPromptRewriter, rewrite_prompt
from windup_common.models import CharacterStance


class _FakeChat:
    def __init__(self, content: object, *, error: Exception | None = None) -> None:
        self.content = content
        self.error = error
        self.messages = None

    def invoke(self, messages):
        self.messages = messages
        if self.error is not None:
            raise self.error
        return SimpleNamespace(content=self.content)


def _errors(text: str, *, kind: str = "i2v") -> list:
    return [i for i in lint(text, kind=kind) if i.level == "error"]


def test_llm_rewrite_invokes_chat_gateway():
    chat = _FakeChat("双脚平稳着地行走")
    out = rewrite_prompt("不要扬尘", kind="i2v", chat_model=chat)
    assert out == "双脚平稳着地行走"
    assert chat.messages is not None


def test_llm_rewrite_passes_stance_and_kind_in_system_prompt():
    chat = _FakeChat("前肢抬高")
    rewrite_prompt(
        "举起左手",
        kind="i2v",
        stance=CharacterStance.QUADRUPED,
        chat_model=chat,
    )
    system = chat.messages[0].content
    assert "四足" in system
    assert "i2v" in system or "视频" in system


def test_llm_rewrite_falls_back_to_original_on_failure():
    chat = _FakeChat("", error=RuntimeError("gateway down"))
    out = rewrite_prompt("不要扬尘", kind="i2v", chat_model=chat)
    assert out == "不要扬尘"


def test_llm_rewrite_empty_output_falls_back_to_original():
    chat = _FakeChat("   ")
    out = rewrite_prompt("轻微抖动一下", kind="i2v", chat_model=chat)
    assert out == "轻微抖动一下"


def test_llm_rewrite_truncates_overlong_model_output():
    chat = _FakeChat("动" * 300)
    out = LlmPromptRewriter(chat).rewrite("walk", kind="i2v")
    assert len(out) <= 200


def test_llm_rewrite_construction_does_not_touch_chat_provider():
    rewriter = LlmPromptRewriter()
    assert rewriter._model is None


@pytest.mark.parametrize(
    ("source", "rewritten"),
    [
        ("不要扬尘", "双脚平稳着地行走"),
        ("轻微抖动一下", "明显抖动一下"),
        (
            "holds the sword steady at the shoulder",
            "holds the sword while the whole body shifts forward",
        ),
    ],
)
def test_llm_rewrite_output_can_satisfy_gate(source, rewritten):
    chat = _FakeChat(rewritten)
    out = rewrite_prompt(source, kind="i2v", chat_model=chat)
    assert not _errors(out), _errors(out)


def test_rewrite_empty_text_is_noop():
    assert rewrite_prompt("") == ""
    assert rewrite_prompt("   ") == ""
