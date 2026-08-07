"""跳跃 i2v 提示词(一次性动作,非循环)。

与 walk/run 的根本差别:
- **不循环**。跳跃是一段有始有终的动作,不能像步态那样抽单周期闭环。
- **要拆状态**。游戏里跳跃是状态机:蓄力 → 上升 → 顶点 → 下降 → 落地缓冲;悬空时长由
  物理决定、上升中可被打断,所以必须能分段播放,不能烘成一整段。
- 提示词要写**"只做一次 + 终态保持"**,防 5s 内复读跳第二次(实测:写了仍会复读,故抽帧层
  另有 first_action_end 兜底)。
- **原地起跳、幅度适中**:水平位移交引擎做 root-motion,不烘进像素;幅度过大会让角色顶出
  视频画面,且序列帧里角色被缩得很小。

朝向同 walk:必须与母版一致(side 横版 / front 俯视·2.5D)。
"""

from __future__ import annotations

__all__ = ["JUMP_BODY_SIDE", "JUMP_BODY_FRONT", "JUMP_PHASES", "build_jump_prompt"]

# 跳跃的五个状态(引擎侧按这个切段;顺序即时间顺序)。
JUMP_PHASES = ("crouch", "rise", "apex", "fall", "land")

JUMP_BODY_SIDE = (
    "The character performs ONE single jump in place, seen from the side facing right: "
    "first the knees bend deep into a crouch and the arms drop back, then both boots push "
    "off the ground and the whole body lifts straight upward a modest height with the legs "
    "tucking up, the body reaches the top of the jump and hangs there for an instant with {garment} "
    "floating upward, then the body falls back down with the legs reaching for the ground, "
    "and both boots land together with the knees bending to absorb the impact, the weapon "
    "stays held steady in a fixed grip the whole time. The character does this ONCE and "
    "then stays standing upright in the landing spot, staying centered in frame."
)

JUMP_BODY_FRONT = (
    "The character performs ONE single jump in place, facing the viewer: first the knees "
    "bend deep into a crouch and the arms drop back, then both boots push off the ground "
    "hard and the whole body launches straight upward with the knees tucking up toward the "
    "camera, the body reaches the top of the jump and hangs there for an instant with "
    "{garment} floating upward, then the body falls back down with the legs reaching for "
    "the ground, and both boots land together with the knees bending to absorb the impact, "
    "the weapon stays held steady in a fixed grip the whole time. The character keeps "
    "FACING THE VIEWER, does this ONCE and then stays standing upright, centered in frame."
)

DEFAULT_GARMENT = "the cape and tabard"


def build_jump_prompt(
    garment: str = DEFAULT_GARMENT, feet: str = "boot", facing: str = "side"
) -> str:
    """按角色装备 + 母版朝向生成跳跃正文。

    Args:
        garment: 起跳时上飘的衣饰。
        feet: 落脚部件用词(替换 boot)。
        facing: "side" 或 "front",**必须与母版朝向一致**。
    """
    if facing not in ("side", "front"):
        raise ValueError(f"facing 只能是 'side' 或 'front',收到 {facing!r}")
    template = JUMP_BODY_SIDE if facing == "side" else JUMP_BODY_FRONT
    body = template.format(garment=garment)
    if feet != "boot":
        body = body.replace("boot", feet)
    return body
