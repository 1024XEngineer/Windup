"""待机 / 攻击 i2v 提示词。

措辞迁自 windup-pipeline 已验证的 prompt_library(idle / slash),按本模块的 facing 分流改写。

- **idle**:循环类(tail_match)。只写躯干呼吸节律,手持物与双脚显式锁定 —— 逐帧生成待机
  只会抖不会呼吸,故走 i2v 或程序化 Idle-B。
- **attack**:一次性类。四条已验证的锁定:①"one single committed motion"防复读;
  ②手持物长度与握点固定;③手持物在身前、宽面朝观者(防 Z 轴穿模与刀刃翻转);④终态回戒备
  并保持。节奏(蓄力慢/挥砍快/触点定格)在抽帧做,不写进 prompt。
- **装备名词不进模板**(#195):②③两条锁定原先写成 "the sword ...",等于断言角色持剑。
  现改为存在无关的 "anything held in that hand ..." —— 锁定效力不变(有持物就锁住它的
  长度/握点/朝向),但不再给空手角色凭空塞一把剑。理由同 :mod:`.walk`。
"""

from __future__ import annotations

from windup_common.models import Facing

__all__ = ["build_idle_prompt", "build_attack_prompt"]

_IDLE_SIDE = (
    "The character stands in place, seen from the side facing right: the chest breathes in one "
    "slow, even rhythm, the ribcage expanding and easing back while the shoulders stay level and "
    "settled at the same height, the torso rising and lowering in that same slow rhythm, "
    "anything held in the hands resting steady at the side in the same grip, whatever the "
    "character already wears hanging and swaying in the "
    "same rhythm, both feet planted firmly on the ground, weight centered, the character stays "
    "in the same spot and keeps facing right."
)

_IDLE_FRONT = (
    "The character stands in place facing the viewer: the chest breathes in one slow, even "
    "rhythm, the ribcage expanding and easing back while the shoulders stay level and settled at "
    "the same height, the torso rising and lowering in that same slow rhythm, anything held in "
    "the hands resting steady at the side in the same grip, whatever the character already wears "
    "hanging and swaying in the same rhythm, both "
    "feet planted firmly on the ground, weight centered, the character keeps FACING THE VIEWER "
    "and stays in the same spot."
)

_ATTACK_SIDE = (
    "Seen from the side facing right, the character makes ONE single committed attack, staying in "
    "STRICT SIDE VIEW the whole time: starting coiled with the weight on the back foot, the body "
    "leans forward and the weight surges onto the front foot, the leading arm sweeping through "
    "one smooth downward crescent arc from high behind the shoulder down across the front to full "
    "extension low, anything held in that hand keeping its exact length and grip position and "
    "staying clearly in front of the body with its broad side facing the viewer the whole way, "
    "whatever the character already wears swinging with "
    "the motion, then the body settles back upright into guard and holds that stance, standing "
    "steady. The torso and hips keep pointing to the right the entire time and the character never "
    "turns toward or away from the viewer."
)

_ATTACK_FRONT = (
    "Facing the viewer, the character makes ONE single committed attack: starting coiled with the "
    "weight on the back foot, the whole body uncoils forward, the leading arm sweeping through "
    "one smooth arc across the front to full extension, anything held in that hand keeping its "
    "exact length and grip position and staying clearly in front of the body with its broad side "
    "facing the viewer the "
    "whole way, whatever the character already wears swinging with the motion, then the body "
    "settles back upright into guard "
    "and holds that stance, standing steady and keeping FACING THE VIEWER."
)


def _build(side: str, front: str, facing: Facing | str) -> str:
    # 非法值在此炸掉,别静默落到 FRONT 模板(理由见 walk.py 同处注释)。
    return side if Facing(facing) is Facing.SIDE else front


def build_idle_prompt(facing: Facing | str = Facing.SIDE) -> str:
    """待机正文(循环类)。``facing`` 须与母版朝向一致。

    注:``weapon`` / ``garment`` / ``feet`` 三个装备参数随 #195 删除,理由见 :mod:`.walk`。
    """
    return _build(_IDLE_SIDE, _IDLE_FRONT, facing)


def build_attack_prompt(facing: Facing | str = Facing.SIDE) -> str:
    """攻击正文(一次性类)。``facing`` 须与母版朝向一致。

    注:``weapon`` / ``garment`` / ``feet`` 三个装备参数随 #195 删除,理由见 :mod:`.walk`。
    """
    return _build(_ATTACK_SIDE, _ATTACK_FRONT, facing)
