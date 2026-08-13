"""母版规格与预处理:每个动作需要什么样的母版。

**核心规律(三次实测验证,写死为契约):母版姿态决定动作,提示词只能微调。**
  - walk:母版**朝侧向**才不转身;正面母版配侧走词 → 模型靠转身调和图文矛盾。
  - jump:母版**顶部留白**才不被视频画面裁掉。
  - attack:必须给**极限蓄力母版**(出手那只手已拉到身后腰际)。用站立母版时,即使提示词
    写死"不过头顶 / 不转身 / 只做一次",模型仍会抡过头顶、转到背面、劈两次 —— 强动作
    先验压不住;换蓄力母版后模型只能"接着往前挥",没有再抡起的空间。

**姿势描述里不写装备名词(#195)。** 这几段是拿去生成母版的提示词,写"the weapon"等于
断言角色持械 —— 空手角色会被凭空塞一把武器,而母版是整条 i2v 链的身份来源,污染会一路
带到所有动作。改为"出手的那只手 / 手里若有东西"这类存在无关的写法,几何约束(拉到腰际、
不过肩)一条不少。同 :mod:`.prompt.walk`。


实测教训:母版里角色居中、占 ~70% 画面高时,i2v 跳跃会让角色**头顶顶出视频画面上沿**
被裁掉(生成本身没错,是构图没留够空间)。规则同 MasterSpec 的"运动方向多留白":
  - jump:向上运动 → 顶部补空间,角色坐低
  - dash / walk / run:向右位移 → 前进方向多留白(由母版生成时构图保证,此处不改)

纯 PIL,零 API。背景色取母版四角中位色,补出来的边与母版底色一致。
"""

from __future__ import annotations

import io

from PIL import Image

from windup_ai_engine._subject import bg_color as _bg_color
from windup_ai_engine.prompt._md import load_section

__all__ = ["add_headroom", "prepare_master", "MASTER_POSES"]

# 各动作所需的母版姿态(生成专用母版时的姿势描述)。
#
# **正文与理由都在 ``prompt/prompts/master_poses.md``**(#233)。空值 = 该动作用中性站立
# 母版即可,不需要专门生成 —— 这是全仓唯一允许"空提示词"的地方,故加载时显式放行;
# 别把 ``allow_empty=True`` 抄到别的提示词上,那边空串会一路跑到付费调用、产出垃圾、
# 任务还显示成功。
MASTER_POSES = {
    a: load_section("master_poses.md", a, allow_empty=True)
    for a in ("walk", "run", "idle", "jump", "attack")
}


def add_headroom(master: bytes, ratio: float = 0.6) -> bytes:
    """在母版上方补空间,让角色坐到画面下部,给腾空留出余量。

    Args:
        master: 母版图 bytes。
        ratio: 处理后角色所占的画面高度比例(越小头顶空间越多)。0.6 表示角色高度
            约占新画面的 60%,上方留约 40%。
    """
    if not 0.1 < ratio < 1.0:
        raise ValueError("ratio 需在 (0.1, 1.0) 之间")
    img = Image.open(io.BytesIO(master)).convert("RGB")
    new_h = max(img.height + 1, int(round(img.height / ratio)))
    canvas = Image.new("RGB", (img.width, new_h), _bg_color(img))
    canvas.paste(img, (0, new_h - img.height))       # 原图贴底,空间加在顶部
    buf = io.BytesIO()
    canvas.save(buf, "PNG")
    return buf.getvalue()


def prepare_master(master: bytes, action: str) -> bytes:
    """按动作类型预处理母版;不需要处理的动作原样返回。"""
    if action in ("jump", "attack"):
        # jump 向上腾空、attack 挥砍过头顶,都会顶出视频画面上沿(实测 attack 15/72 帧触顶)
        return add_headroom(master, ratio=0.62 if action == "jump" else 0.70)
    return master
