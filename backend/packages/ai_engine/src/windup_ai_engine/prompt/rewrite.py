"""提示词预改写 —— 在措辞门禁之前,用 Chat Gateway 按 lint 标准优化用户描述。

改写失败时回退原文,不阻断生成;措辞门禁与拒绝逻辑仍由 adapter 负责。
"""
from __future__ import annotations

from typing import Any

from langchain_core.messages import HumanMessage, SystemMessage

from windup_common.models import CharacterStance

from windup_ai_engine.prompt.custom import MAX_ACTION_CHARS
from windup_ai_engine.prompt.lint import Kind

__all__ = ["LlmPromptRewriter", "rewrite_prompt"]

_STANCE_HINT = {
    CharacterStance.BIPED: "双足角色,可以使用手臂/手等人体部位词。",
    CharacterStance.QUADRUPED: "四足角色,不要用人的手臂/手,改用前肢、头颈或尾。",
    CharacterStance.SERPENTINE: "蛇形角色,不要用人的手臂/手,改用躯干起伏、头颈或尾。",
}

_KIND_HINT = {
    "i2v": "目标是一次视频动作生成:描述一段连续动作,亚阈值微动要改成可见幅度。",
    "still": "目标是单张静态姿势:只保留一个瞬间,去掉多阶段(然后/再/最后之后的内容)。",
}


def _system_prompt(*, kind: Kind, stance: CharacterStance) -> str:
    return (
        "你是角色动作描述的预改写器。把用户输入改写成更适合 i2v/静态姿势模型的"
        "正向动作描述。只输出改写后的描述本身,不要引号、解释或前后缀。\n\n"
        "必须遵守与措辞门禁相同的标准:\n"
        "1. 否定式改成正面描述(该通路没有 negative_prompt,\"不要 X\"会把 X 画进画面)\n"
        "2. 去掉烟尘/火花/火焰/扬尘等特效名词,只写身体在做什么\n"
        "3. 去掉装备形状先验(刃面/弧线/前手等),只写身体怎么发力\n"
        "4. 亚阈值微动改成看得见的幅度\n"
        "5. 若出现持物动作,补一句身体整体怎么动(躯干/重心/整体位移)\n"
        f"6. {_STANCE_HINT[stance]}\n"
        f"7. {_KIND_HINT[kind]}\n\n"
        f"保持原意,只描述动作,不超过 {MAX_ACTION_CHARS} 字。"
    )


def _clean_rewrite(raw: object, *, original: str) -> str:
    text = raw if isinstance(raw, str) else str(raw or "")
    text = text.strip().strip("\"'“”‘’").strip()
    if not text:
        return original
    return text[:MAX_ACTION_CHARS]


class LlmPromptRewriter:
    """经 Chat Gateway 改写动作描述;``chat_model`` 可注入以便测试。"""

    def __init__(self, chat_model: Any | None = None) -> None:
        self._model = chat_model

    def _chat_model(self) -> Any:
        if self._model is None:
            from windup_framework.providers import create_chat_model

            self._model = create_chat_model()
        return self._model

    def rewrite(
        self,
        text: str,
        *,
        kind: Kind = "i2v",
        stance: CharacterStance | str = CharacterStance.BIPED,
    ) -> str:
        clause = (text or "").strip()
        if not clause:
            return clause

        stance = CharacterStance(stance)
        result = self._chat_model().invoke(
            [
                SystemMessage(content=_system_prompt(kind=kind, stance=stance)),
                HumanMessage(content=clause),
            ]
        )
        content = getattr(result, "content", result)
        return _clean_rewrite(content, original=clause)


def rewrite_prompt(
    text: str,
    *,
    kind: Kind = "i2v",
    stance: CharacterStance | str = CharacterStance.BIPED,
    chat_model: Any | None = None,
) -> str:
    """LLM 预改写;失败时回退原文。"""
    clause = (text or "").strip()
    if not clause:
        return clause
    try:
        return LlmPromptRewriter(chat_model).rewrite(
            clause, kind=kind, stance=stance,
        )
    except Exception:
        return clause
