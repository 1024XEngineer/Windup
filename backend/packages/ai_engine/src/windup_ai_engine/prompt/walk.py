"""走路 i2v 提示词(视频路线)。

实测要点(Issue #35):
- 只写正向词、逐条写腿部可见动作(抬 / 摆 / 蹬 / 承重),锁死手持武器不乱动。
- **提示词的朝向必须与母版朝向一致**。给正面母版喂侧走词(STRICT SIDE)会让模型靠"转身"
  调和图文矛盾——早期"正面母版必转身"的结论正是这么造成的。故按 facing 分流:
  side(横版侧走)/ front(俯视·2.5D 朝观者行进),对应 Project.perspective。
- "半侧"母版(头侧脸 + 身体略正)配 side 词,实测会被自然解析成正侧面走,不转身,够用。
- 换角色只替换装备子句(如 骷髅:boot→骨足、cape→围巾),机制词保持不变。
"""

from __future__ import annotations

__all__ = ["WALK_BODY_SIDE", "WALK_BODY_FRONT", "DEFAULT_GARMENT", "build_walk_prompt"]

# 侧走(横版):整体向右推进 + 锁侧视。
WALK_BODY_SIDE = (
    "The character walks steadily to the right through the open space, the whole body "
    "advancing with every stride: the front boot lifts, swings forward and plants heel "
    "first, the rear boot pushes off the ground, the hips and torso carry the weight "
    "forward over the planted foot, {garment} swing with the steps, the weapon stays held "
    "low and steady at the side in a fixed grip, the upper body stays calm and upright, "
    "SIDE VIEW facing right the whole time, the legs clearly visible."
)

# 正面走(俯视 / 2.5D):朝观者原地行进,身体始终正对观者、不转身。
WALK_BODY_FRONT = (
    "The character walks in place toward the viewer, marching forward on the spot: each "
    "boot lifts, swings forward and plants down in turn while the other pushes off, the "
    "knees rise alternately toward the camera, the hips and shoulders sway naturally with "
    "each step, {garment} sway with the steps, the weapon stays held low and steady in a "
    "fixed grip, the upper body stays calm and upright, the character keeps FACING THE "
    "VIEWER the whole time and stays centered in frame, both legs clearly visible."
)

# 每个角色只替换 garment / feet 两处装备子句,机制词不动。
DEFAULT_GARMENT = "the cape and tabard"


def build_walk_prompt(
    garment: str = DEFAULT_GARMENT, feet: str = "boot", facing: str = "side"
) -> str:
    """按角色装备 + 母版朝向生成走路正文。

    Args:
        garment: 随步伐摆动的衣饰(如 "the cape and tabard" / "the red scarf and tabard")。
        feet: 落脚部件用词(如 "boot" / "bare bony foot"),替换机制句里的 boot。
        facing: "side"(横版侧走,母版朝侧向)或 "front"(俯视/2.5D,母版朝观者)。
            **必须与母版朝向一致**,否则模型会靠转身调和矛盾。
    """
    if facing not in ("side", "front"):
        raise ValueError(f"facing 只能是 'side' 或 'front',收到 {facing!r}")
    template = WALK_BODY_SIDE if facing == "side" else WALK_BODY_FRONT
    body = template.format(garment=garment)
    if feet != "boot":
        body = body.replace("boot", feet)
    return body
