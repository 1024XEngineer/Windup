"""提示词措辞门禁 —— 纯函数,只依赖标准库。

这里每条规则约束的都是**模型侧的机制**,不是团队的文风偏好;报错信息也按机制写,
因为收到它的人要据此改自己的描述,"命中禁词"这种话给不了任何改法。

规则与机制:
  - 否定式:该 i2v 接口没有 negative_prompt,模型不处理否定极性、只 latch 到名词上,
    于是"不要 X"把 X 送进画面。任何否定都要改成正面描述。
  - 特效名词(烟尘/火花/火焰…):提到即被勾成画面里的效果,它盖住角色轮廓,
    抠图与像素化会在边缘留脏。
  - 冲击词:不直接生成特效,但强相关,常连带勾出烟尘碎屑 —— 故只降级提示。
  - 亚阈值微动:要求的位移小于模型可控的分辨率,得到的不是小幅动作而是逐帧随机抖动。
  - 持物无身体锚:i2v 强跟身体、弱跟手持物;身体整体怎么动没被指定时,持物自行漂移。
  - 装备形状先验:母版是角色身份的唯一来源。断言刃面朝向 / 弧线 / 前手这类形状,
    等于把母版里不存在的形状焊到角色身上,并跟着该角色去到所有动作。
    装备名词只降级提示 —— 用户看着自己的母版写"剑"可能属实,而形状先验用户无从判断。

``kind`` 的适用范围按机制划,不按方便:亚阈值微动与持物锚定都靠"帧与帧之间"才成立,
静态图没有帧间(前者退成弱指令、后者整条不成立,单件道具素材图里根本没有身体)。
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Literal

__all__ = ["Kind", "Level", "LintIssue", "lint"]

Kind = Literal["i2v", "still"]
Level = Literal["error", "warn"]


@dataclass(frozen=True)
class LintIssue:
    """一条命中。``term`` 给的是原文里真实出现的那段字,便于调用方定位。"""

    level: Level
    category: str
    term: str
    message: str


# 汉字没有词边界,ASCII 才加 \b;分开存是为了让两类词用各自正确的匹配方式,
# 而不是让中文词退化成"整词匹配"从而永不命中。
_NEGATION = (
    "no", "not", "never", "without", "avoid", "avoids", "avoiding",
    "don't", "doesn't", "isn't", "aren't", "won't", "cannot",
    "不要", "不能", "不许", "禁止", "避免", "勿",
)
_HAZARD = (
    "dust", "dusty", "smoke", "smoky", "smoking", "spark", "sparks", "sparking",
    "debris", "flame", "flames", "flaming", "fire", "fires", "fiery",
    "ember", "embers", "dirt", "haze", "hazy",
    "烟雾", "扬尘", "火花", "灰尘", "火焰", "碎屑",
)
_IMPACT = (
    "impact", "impacts", "strike", "strikes", "striking", "struck",
    "hammer", "hammers", "hammering", "slam", "slams", "slamming",
    "smash", "smashes", "smashing", "explosive", "explosion",
    "burst", "bursts", "bursting", "slash", "slashes", "slashing",
    "冲击", "命中", "劈砍",
)
_SUBTHRESHOLD = (
    "slightly", "slight", "subtle", "subtly", "tiny", "barely", "faint",
    "faintly", "micro", "minuscule",
    "轻微", "细微", "几个像素", "一点点", "微微",
)
# 持物动作词。刻意不收"挥/swing":它们同样用于空手动作(挥手),而 2b 的机制只在
# 手里真有东西时成立,收进来会把"挥手"判成漂移风险。
_PROP_ACTION = (
    "hold", "holds", "holding", "held", "grip", "grips", "gripping",
    "wield", "wields", "wielding", "brandish", "brandishes", "brandishing",
    "握", "持", "拿着", "举着", "挥剑", "挥刀", "挥舞",
)
# 只收"整个身体往哪儿去"的词。肩、胸这类上肢局部不算锚:它们与手持物一起漂,
# 定不住整体,收进来等于让 2b 形同虚设。
_BODY_ANCHOR = (
    "whole body", "body", "torso", "hips", "waist",
    "lunge", "lunges", "step", "steps", "stride", "strides",
    "身体", "躯干", "重心", "整体", "腰",
)
_SHAPE_PRIOR = (
    "broad side", "broadside", "flat side", "flat of the blade", "blade side",
    "crescent", "crescent arc", "leading arm", "leading hand", "leading edge",
    "刃面", "新月", "前手", "前臂朝",
)
_EQUIPMENT = (
    "sword", "blade", "weapon", "staff", "wand", "axe", "spear", "shield",
    "dagger", "bow", "gun", "rifle",
    "剑", "刀", "武器", "盾", "法杖", "长矛", "弓",
)

_ASCII_WORD = re.compile(r"^[a-z' ]+$")


def _compile(terms: tuple[str, ...]) -> re.Pattern[str]:
    parts = [
        rf"\b{re.escape(t)}\b" if _ASCII_WORD.match(t) else re.escape(t)
        for t in terms
    ]
    return re.compile("|".join(parts), re.IGNORECASE)


_PATTERNS = {
    name: _compile(terms)
    for name, terms in (
        ("negation", _NEGATION), ("hazard", _HAZARD), ("impact", _IMPACT),
        ("subthreshold", _SUBTHRESHOLD), ("prop", _PROP_ACTION),
        ("body", _BODY_ANCHOR), ("shape_prior", _SHAPE_PRIOR),
        ("equipment", _EQUIPMENT),
    )
}


def _hits(text: str, name: str) -> list[str]:
    """按出现顺序去重,免得同一个词在长句里刷出十条一模一样的问题。"""
    seen: dict[str, None] = {}
    for m in _PATTERNS[name].finditer(text):
        seen.setdefault(m.group(0).lower(), None)
    return list(seen)


def lint(text: str, *, kind: Kind = "i2v") -> list[LintIssue]:
    """按目标模型类型查一段提示词。

    ``kind`` 只影响 2a / 2b 两条:它们的机制都是帧与帧之间的,静态图没有帧间。
    """
    issues: list[LintIssue] = []

    for term in _hits(text, "negation"):
        issues.append(LintIssue(
            "error", "negation", term,
            f"「{term}」是否定式。这条通路没有 negative_prompt,模型不处理否定极性、"
            f"只把名词 latch 进画面,写「不要 X」等于点名要 X。改成正面说你要的样子。",
        ))
    for term in _hits(text, "hazard"):
        issues.append(LintIssue(
            "error", "hazard_noun", term,
            f"「{term}」是特效名词,提到即被勾成画面里的效果;它盖住角色轮廓,"
            f"后面的抠图和像素化会在边缘留下脏边。只写身体在做什么。",
        ))
    for term in _hits(text, "shape_prior"):
        issues.append(LintIssue(
            "error", "shape_prior", term,
            f"「{term}」是装备的形状先验。角色身份的唯一来源是母版,提示词里断言刃面 / "
            f"弧线 / 前手这类形状,会把母版里没有的形状焊到这个角色身上,并跟着它去到"
            f"所有动作。只描述身体怎么发力。",
        ))
    for term in _hits(text, "impact"):
        issues.append(LintIssue(
            "warn", "impact_verb", term,
            f"「{term}」是冲击词,模型常连带画出烟尘碎屑。换成具体的身体动作"
            f"(哪个部位先动、往哪个方向发力)更稳。",
        ))
    for term in _hits(text, "equipment"):
        issues.append(LintIssue(
            "warn", "equipment_noun", term,
            f"「{term}」在断言这个角色带着某件装备。带没带由母版说了算,写在提示词里"
            f"与母版不一致时,模型会自己造一件出来。",
        ))

    for term in _hits(text, "subthreshold"):
        # 静态图没有帧间,抖不起来;但"轻微"对单张图同样给不出可执行的幅度,故仍报。
        level: Level = "error" if kind == "i2v" else "warn"
        issues.append(LintIssue(
            level, "subthreshold", term,
            f"「{term}」要求的幅度低于模型可控的分辨率。"
            + ("视频侧拿到的不是小幅动作,而是逐帧随机抖动。"
               if kind == "i2v" else "静态图没有帧间抖动,但它仍是一条模型执行不了的弱指令。")
            + "给一个看得见的幅度(动到哪儿、动多远)。",
        ))

    if kind == "i2v":
        props = _hits(text, "prop")
        if props and not _hits(text, "body"):
            issues.append(LintIssue(
                "error", "unanchored_prop", props[0],
                f"写了持物动作「{props[0]}」,却没交代身体整体怎么动。i2v 强跟身体、"
                f"弱跟手持物:身体没被指定时,手里的东西会自己漂。补一句躯干 / 重心 / "
                f"整体位移。",
            ))
    return issues
