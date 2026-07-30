"""待机 / 攻击 i2v 提示词。

措辞迁自 windup-pipeline 已验证的 prompt_library(idle / slash),按本模块的 facing 分流改写。

- **idle**:循环类(tail_match)。只写躯干呼吸节律,武器与双脚显式锁定 —— 逐帧生成待机
  只会抖不会呼吸,故走 i2v 或程序化 Idle-B。
- **attack**:一次性类。四条已验证的锁定:①"one single committed motion"防复读;
  ②剑长与握点固定;③剑在身前、刃面朝观者(防 Z 轴穿模与刀刃翻转);④终态回戒备并保持。
  节奏(蓄力慢/挥砍快/触点定格)在抽帧做,不写进 prompt。
"""

from __future__ import annotations

__all__ = ["build_idle_prompt", "build_attack_prompt"]

_IDLE_SIDE = (
    "The character stands in place, seen from the side facing right: the chest breathes in one "
    "slow, even rhythm, the ribcage expanding and easing back while the shoulders stay level and "
    "settled at the same height, the torso rising and lowering in that same slow rhythm, "
    "{weapon} resting steady at the side in a fixed grip, {garment} hanging and swaying in the "
    "same rhythm, both boots planted firmly on the ground, weight centered, the character stays "
    "in the same spot and keeps facing right."
)

_IDLE_FRONT = (
    "The character stands in place facing the viewer: the chest breathes in one slow, even "
    "rhythm, the ribcage expanding and easing back while the shoulders stay level and settled at "
    "the same height, the torso rising and lowering in that same slow rhythm, {weapon} resting "
    "steady at the side in a fixed grip, {garment} hanging and swaying in the same rhythm, both "
    "boots planted firmly on the ground, weight centered, the character keeps FACING THE VIEWER "
    "and stays in the same spot."
)

_ATTACK_SIDE = (
    "Seen from the side facing right, the character makes ONE single committed attack, staying in "
    "STRICT SIDE VIEW the whole time: starting coiled with the weight on the back foot, the body "
    "leans forward and the weight surges onto the front foot, the arm sweeping {weapon} through "
    "one smooth downward crescent arc from high behind the shoulder down across the front to full "
    "extension low, {weapon} keeping its exact length and grip position and staying clearly in "
    "front of the body with its flat side facing the viewer the whole way, {garment} swinging with "
    "the motion, then the body settles back upright into guard and holds that stance, standing "
    "steady. The torso and hips keep pointing to the right the entire time and the character never "
    "turns toward or away from the viewer."
)

_ATTACK_FRONT = (
    "Facing the viewer, the character makes ONE single committed attack: starting coiled with the "
    "weight on the back foot, the whole body uncoils forward, the arm sweeping {weapon} through "
    "one smooth arc across the front to full extension, {weapon} keeping its exact length and grip "
    "position and staying clearly in front of the body with its flat side facing the viewer the "
    "whole way, {garment} swinging with the motion, then the body settles back upright into guard "
    "and holds that stance, standing steady and keeping FACING THE VIEWER."
)

DEFAULT_WEAPON = "the sword"
DEFAULT_GARMENT = "the cape"


def _build(side: str, front: str, weapon: str, garment: str, feet: str, facing: str) -> str:
    if facing not in ("side", "front"):
        raise ValueError(f"facing 只能是 'side' 或 'front',收到 {facing!r}")
    body = (side if facing == "side" else front).format(weapon=weapon, garment=garment)
    return body.replace("boot", feet) if feet != "boot" else body


def build_idle_prompt(
    weapon: str = DEFAULT_WEAPON,
    garment: str = DEFAULT_GARMENT,
    feet: str = "boot",
    facing: str = "side",
) -> str:
    """待机正文(循环类)。``facing`` 须与母版朝向一致。"""
    return _build(_IDLE_SIDE, _IDLE_FRONT, weapon, garment, feet, facing)


def build_attack_prompt(
    weapon: str = DEFAULT_WEAPON,
    garment: str = DEFAULT_GARMENT,
    feet: str = "boot",
    facing: str = "side",
) -> str:
    """攻击正文(一次性类)。``facing`` 须与母版朝向一致。"""
    return _build(_ATTACK_SIDE, _ATTACK_FRONT, weapon, garment, feet, facing)
