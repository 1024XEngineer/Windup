"""所有动作共用的构图约束。

由代码统一追加而不是抄进每份 md:同一条约束抄 N 份会各自漂移。

只写正向计数句 —— 该 i2v 接口没有 negative_prompt,否定句里的名词会被 latch 进画面
(实测"do not add dust"反而勾出更多灰尘),所以说"恰好一个",不说"不要第二个"。
"""

from __future__ import annotations

from windup_common.directions import ActionDirection, direction_prompt

__all__ = [
    "REFERENCE_FIDELITY_LOCK",
    "SINGLE_SUBJECT_FRAMING",
    "with_framing",
    "with_direction_lock",
]

# 攻击的两处留白(母版姿态要求 + 母版补边)让画面空得足以容下第二个主体。
SINGLE_SUBJECT_FRAMING = (
    "Exactly one character is in the frame, alone against a plain flat solid-color background, "
    "and the whole body stays inside the frame."
)

REFERENCE_FIDELITY_LOCK = (
    "Preserve the reference character's exact face, hairstyle, clothing, accessories, "
    "color palette, linework, silhouette, textures, and local details throughout every frame. "
    "Use a locked camera with unchanged projection, framing, character scale, and canvas "
    "occupancy throughout the video."
)


def with_framing(body: str) -> str:
    """给一段动作正文接上构图与视频保真约束。"""
    # SINGLE_SUBJECT_FRAMING 保持最终收口句:提示词适配器的契约会用它确认公共构图约束
    # 没被自定义动作分支绕过。新增约束插在它之前,不改变这个既有边界。
    return f"{body} {REFERENCE_FIDELITY_LOCK} {SINGLE_SUBJECT_FRAMING}"


def with_direction_lock(body: str, direction: ActionDirection | None) -> str:
    """把显式方向锁放在动作模板之后，覆盖模型可能推断出的朝向。

    底层引擎仍允许旧调用不声明 ``direction``；这时保留原来的 facing 模板，
    不能擅自把它当成 east。服务端真正提交的生成任务会显式传入方向。
    """

    if direction is None:
        return body
    return f"{body} {direction_prompt(direction)}"
