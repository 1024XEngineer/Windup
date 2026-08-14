"""自定义动作 i2v 提示词(#239)。

动作内容来自用户,本模块只提供骨架。骨架负责四件用户那句话给不了的事:朝向锁、只写正向词
(该接口无 negative_prompt,否定词里的名词会被 latch 进画面)、装备存在无关句(#195)、
一次性动作的单次 + 终态保持。
"""

from __future__ import annotations

from windup_common.models import Facing

from windup_ai_engine.prompt._framing import with_framing

__all__ = ["build_custom_prompt", "MAX_ACTION_CHARS"]

# 不是接口限制,是产品判断:描述越长越容易夹带角色外观,而外观由母版承载,写两遍会打架。
MAX_ACTION_CHARS = 200

_FACING_LOCK = {
    Facing.SIDE: (
        "seen from the side facing right, staying in SIDE VIEW facing right the whole time, "
        "the torso and hips keep pointing to the right"
    ),
    Facing.FRONT: (
        "facing the viewer, the character keeps FACING THE VIEWER the whole time "
        "and stays centered in frame"
    ),
}

# 存在无关:锁住"别乱动",但不断言角色有什么(#195)。
_KEEP_WHAT_IT_HAS = (
    "whatever the character already wears or carries keeps its own shape and moves with the body, "
    "anything held in the hands stays in the same grip at the same angle"
)

# 两条尾句都刻意不写"在地面上 / 双脚可见 / 回到直立站姿"——那些是着地直立类动作的前提,
# 游泳、飞行、攀爬、倒地都不成立,而文字与动作矛盾时模型会自己找辙调和。
_CYCLIC_TAIL = (
    "The motion is one smooth repeating cycle that returns to its starting pose, "
    "and the character stays centered in the same spot in frame."
)
_ONESHOT_TAIL = (
    "The character performs this ONCE as one single committed motion, "
    "then holds the final pose and stays still."
)


def build_custom_prompt(
    action: str,
    *,
    facing: Facing | str = Facing.SIDE,
    cyclic: bool = False,
) -> str:
    """把用户自述的动作嵌进骨架。

    Args:
        action: 动作内容(如 "waves the right hand above the head")。只写做什么动作。
        facing: 母版朝向。**必须与母版一致**,否则模型靠转身调和矛盾。
        cyclic: 是否循环。与 slicing 走 pick_cycle / pick_oneshot 同一口径。

    Raises:
        ValueError: 描述为空或超长。空描述不兜底默认动作——那会付一次 i2v 的钱拿到一段
            站着不动的视频,而帧数时长全对、看不出描述丢了。
    """
    text = (action or "").strip()
    if not text:
        raise ValueError("自定义动作的描述不能为空")
    if len(text) > MAX_ACTION_CHARS:
        raise ValueError(f"自定义动作描述 {len(text)} 字,超过上限 {MAX_ACTION_CHARS}")
    lock = _FACING_LOCK[Facing(facing)]      # 非法朝向要炸,不静默落到某一支
    tail = _CYCLIC_TAIL if cyclic else _ONESHOT_TAIL
    # 朝向放最前:最强的约束先钉。
    return with_framing(f"The character {lock}: {text}, {_KEEP_WHAT_IT_HAS}. {tail}")
