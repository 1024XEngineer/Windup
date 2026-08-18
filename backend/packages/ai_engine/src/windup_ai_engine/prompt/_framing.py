"""所有动作共用的构图约束。

由代码统一追加而不是抄进每份 md:同一条约束抄 N 份会各自漂移。

只写正向计数句 —— 该 i2v 接口没有 negative_prompt,否定句里的名词会被 latch 进画面
(实测"do not add dust"反而勾出更多灰尘),所以说"恰好一个",不说"不要第二个"。
"""
from __future__ import annotations

__all__ = ["SINGLE_SUBJECT_FRAMING", "with_framing"]

# 攻击的两处留白(母版姿态要求 + 母版补边)让画面空得足以容下第二个主体。
SINGLE_SUBJECT_FRAMING = (
    "Exactly one character is in the frame, alone against a plain flat solid-color background, "
    "and the whole body stays inside the frame."
)


def with_framing(body: str) -> str:
    """给一段动作正文接上构图约束。"""
    return f"{body} {SINGLE_SUBJECT_FRAMING}"
