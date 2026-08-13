"""走路 i2v 提示词(视频路线)。

提示词正文在 ``prompts/walk.md``(#233),本模块只留加载与按 facing 分流。
措辞经过校准,**逐字改动前先查内部实验记录**。
"""
from __future__ import annotations

from windup_common.models import Facing

from windup_ai_engine.prompt._md import load_section

__all__ = ["build_walk_prompt"]

_DOC = "walk.md"

# 注:这里曾有 ``WALK_BODY_SIDE`` / ``WALK_BODY_FRONT`` 两个常量,配一个模块级
# ``__getattr__`` 现取,理由写的是"import 期读文件会让 md 缺失表现成 import 崩溃"。
#
# **那套机器不成立,已删(FennoAI 评审逮到)**:``prompt/__init__`` 里有
# ``from .walk import WALK_BODY_FRONT, WALK_BODY_SIDE``,而这两个名字只有注解、从没赋值,
# 于是这条 from-import 恰好经 ``__getattr__`` 触发 ``load_section`` —— md 照样在
# **import 期**被读:``import windup_ai_engine.prompt`` 会连带读进 walk.md。
# 也就是说那段 docstring 描述的保证从来没生效过,它只是看起来生效。
#
# 删掉之后策略反而统一了,而且不需要任何延迟加载机器:
#   · ``build_*_prompt`` 是**函数**,天然调用时才读;
#   · ``MASTER_POSES`` 是**模块级常量**,天然 import 期读 —— 见 master_prep 里的说明。
# 两者缺失时都抛 PromptAssetError,方向一致。
#
# 那两个常量的唯一消费方是一条断言 ``build_walk_prompt("side") == WALK_BODY_SIDE``,
# 而搬进 md 之后两边读的是同一份文件的同一节,必然相等 —— 循环论证,测不出东西。
# 该测试已改成断言实质属性(朝向锁短语在不在对的那一条里)。


def build_walk_prompt(facing: Facing | str = Facing.SIDE) -> str:
    """按母版朝向生成走路正文。

    Args:
        facing: :class:`Facing` 成员(或其等价字符串)。**必须与母版朝向一致**,
            否则模型会靠转身调和矛盾。

    注:曾有 ``garment`` / ``feet`` 两个装备参数,随 #195 删除 —— 零写入方
    (``strategy.concrete._build_prompt`` 只传 ``facing``)。要按角色定制装备文字得先有
    地方存"这个角色穿什么拿什么",那是角色卡契约的事;在这里留一个没人传的参数,只会
    让人以为该能力已经存在。
    """
    # 注解不是运行期约束:build_* 是普通函数,传 "sidee" 仍进得来。这里显式过一遍
    # Facing() 构造,非法值抛 ValueError —— 若改成 `if facing == Facing.SIDE else FRONT`
    # 的二分,"sidee" 会静默落到 FRONT 模板,拿到一段正面走的视频却没有任何报错。
    return load_section(_DOC, Facing(facing).value)
