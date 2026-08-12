"""自定义动作 i2v 提示词(#239)。

与 walk / jump / idle / attack 的根本差别:那四个的动作内容是我们手写、逐句实测过的;
custom 的动作内容来自用户,我们**只提供骨架**。

**骨架不是装饰,它是这条路线能用的全部原因。** 把用户那句话直接丢给 i2v,会一次丢掉四项
拿实测换来的锁:

  ① **朝向锁**。提示词朝向必须与母版一致(三次实测,见 :mod:`..master_prep`)。给正面母版
     喂侧向词,模型会靠"转身"调和图文矛盾 —— 早期"正面母版必转身"的结论正是这么造成的。
  ② **只写正向词**。这个 i2v 接口没有 negative_prompt,写"不要 X"会让 X 被 latch 进画面。
     所以骨架里一句否定式都没有,连"不转身"也写成 "keeps facing right"。
  ③ **装备存在无关**(#195)。模板里一旦出现装备名词就是在断言该物件存在:母版没有斗篷时
     模型会为了满足文字凭空长一件,而母版真有的特征(颈后软管)反被挤掉。实测同一母版
     只换提示词,斗篷 16/16 帧 → 0/20 帧。故衣饰/手持物一律写成存在无关的保持句。
  ④ **一次性动作要"只做一次 + 终态保持"**。不写会在 5 秒内复读第二次(实测)。

用户那句描述只填"做什么动作"这一段,其余全由骨架给。
"""

from __future__ import annotations

from windup_common.models import Facing

__all__ = ["build_custom_prompt", "MAX_ACTION_CHARS"]

# 用户描述的长度上限。不是接口限制(kling 的 prompt 可以很长),而是**产品判断**:
# 描述越长越容易夹带角色外观("穿红裙的女孩挥手"),而外观由母版承载,再写一遍会和母版打架。
# 超长时在入口截断并不合适(会截出半句),故由调用方校验、这里只做兜底断言。
MAX_ACTION_CHARS = 200

# 骨架的三段,与 walk/jump/actions 里那几套同源(措辞逐字对齐,便于日后一起改)。

# 朝向锁:两个朝向各一句,且都是正向表述。
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

# 存在无关的衣饰 / 手持物保持句(#195)。既锁住"别乱动",又不断言角色有什么。
_KEEP_WHAT_IT_HAS = (
    "whatever the character already wears or carries keeps its own shape and moves with the body, "
    "anything held in the hands stays in the same grip at the same angle"
)

# 循环类:强调可无缝首尾相接、身体不整体位移(位移交引擎当 root motion)。
_CYCLIC_TAIL = (
    "The motion is one smooth repeating cycle that returns to the starting pose, "
    "the character stays in the same spot on the ground, both feet stay clearly visible."
)

# 一次性类:只做一次 + 终态保持(防复读)。
_ONESHOT_TAIL = (
    "The character performs this ONCE as one single committed motion, "
    "then settles back into a calm upright standing pose and holds that pose, standing steady."
)


def build_custom_prompt(
    action: str,
    *,
    facing: Facing | str = Facing.SIDE,
    cyclic: bool = False,
) -> str:
    """把用户自述的动作嵌进已验证的机制骨架。

    Args:
        action: 用户写的动作内容(如 "waves the right hand above the head")。
            **只写做什么动作**;写角色外观会和母版打架(见模块 docstring ③)。
        facing: 母版朝向。**必须与母版一致**,否则模型靠转身调和矛盾。
        cyclic: 是否循环播放。决定用闭环尾句还是"只做一次"尾句,
            并与 ``slicing`` 走 pick_cycle / pick_oneshot 保持同一口径。

    Raises:
        ValueError: 动作描述为空,或超过 :data:`MAX_ACTION_CHARS`。
            空描述不给兜底默认动作 —— 那会让调用方付一次 i2v 的钱拿到一段站立不动的视频,
            而帧数时长全对、看不出是"描述丢了"。
    """
    text = (action or "").strip()
    if not text:
        raise ValueError("自定义动作的描述不能为空;空描述会付一次 i2v 的钱拿到一段站着不动的视频")
    if len(text) > MAX_ACTION_CHARS:
        raise ValueError(
            f"自定义动作描述 {len(text)} 字,超过上限 {MAX_ACTION_CHARS}。"
            "过长的描述通常在复述角色外观,而外观由母版承载、再写一遍会和母版打架"
        )
    # 非法朝向在此炸掉,别静默落到某一支(理由见 prompt.walk 同处注释)。
    lock = _FACING_LOCK[Facing(facing)]
    tail = _CYCLIC_TAIL if cyclic else _ONESHOT_TAIL

    # 顺序有讲究:先钉朝向(最强约束放最前),再给用户的动作内容,再补存在无关的保持句,
    # 最后是循环性尾句。与 walk/attack 那几套的句序一致。
    return (
        f"The character {lock}: {text}, {_KEEP_WHAT_IT_HAS}, "
        f"the upper body stays calm and the legs clearly visible. {tail}"
    )
