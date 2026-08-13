"""走路 i2v 提示词(视频路线)。

**正文与实测理由都在 ``prompts/walk.md``**(#233)。本模块只留加载与按 facing 分流 ——
那几条理由(为什么只写正向词、为什么朝向必须与母版一致、装备名词为什么不能进模板 #195)
是拿钱和时间换来的记录,和它们解释的正文放在一起才不会失散。
"""
from __future__ import annotations

from windup_common.models import Facing

from windup_ai_engine.prompt._md import load_section

__all__ = ["WALK_BODY_SIDE", "WALK_BODY_FRONT", "build_walk_prompt"]

_DOC = "walk.md"

# 只声明类型、不赋值:运行期仍由下面的 __getattr__ 现取(见其 docstring 里为什么不在
# import 期读文件),而静态检查能看到这两个名字确实是本模块导出的。
WALK_BODY_SIDE: str
WALK_BODY_FRONT: str


def __getattr__(name: str) -> str:
    """``WALK_BODY_SIDE`` / ``WALK_BODY_FRONT`` 保持可导入(测试与外部引用在用)。

    做成模块级 ``__getattr__`` 而不是 import 期常量:import 期读文件会让"md 没打进
    wheel"表现成 import 崩溃,连带整个 ai_engine 起不来;而真正该报错的时机是**构建
    提示词时**,那样错误信息能指出是哪个动作、哪一节。
    """
    if name == "WALK_BODY_SIDE":
        return load_section(_DOC, "side")
    if name == "WALK_BODY_FRONT":
        return load_section(_DOC, "front")
    raise AttributeError(name)


def build_walk_prompt(facing: Facing | str = Facing.SIDE) -> str:
    """按母版朝向生成走路正文。

    Args:
        facing: :class:`Facing` 成员(或其等价字符串)。**必须与母版朝向一致**,
            否则模型会靠转身调和矛盾。

    注:曾有 ``garment`` / ``feet`` 两个装备参数(默认 "the cape and tabard" / "boot")。
    2026-08-12 随 #195 删除 —— 零写入方(``strategy.concrete._build_prompt`` 只传
    ``facing``),于是每个角色都拿那个持剑披风原型的默认值。要按角色定制装备文字得先有
    地方存"这个角色穿什么拿什么",那是角色卡契约的事;在这里留一个没人传的参数,只会
    让人以为该能力已经存在。
    """
    # 注解不是运行期约束:build_* 是普通函数,传 "sidee" 仍进得来。这里显式过一遍
    # Facing() 构造,非法值抛 ValueError —— 若改成 `if facing == Facing.SIDE else FRONT`
    # 的二分,"sidee" 会静默落到 FRONT 模板,拿到一段正面走的视频却没有任何报错。
    return load_section(_DOC, Facing(facing).value)
