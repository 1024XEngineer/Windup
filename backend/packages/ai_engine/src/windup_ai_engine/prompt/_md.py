"""提示词 markdown 的加载器。

为什么提示词正文住在 markdown 而不是 Python 字符串常量(#233):它是**数据不是代码** ——
原先被 Python 隐式字符串拼接切成多行,改一个词的 diff 全是噪声;而想调措辞的人不一定
想改 Python。搬进 md 之后 Python 只留加载与按 facing 分流。

━━ 一条硬约束:缺文件 / 缺节 / 空内容必须当场抛错 ━━

md 没打进 wheel → 提示词变成空串 → **付费 i2v 调用照常发出**、产出垃圾、任务显示成功。
那是本仓最忌讳的"看起来成功的错结果",不能靠"应该不会漏"兜着。所以本模块所有出错路径
都抛 :class:`PromptAssetError`,并带上"找的哪个文件、期望什么结构"。

`importlib.resources` 而不是 `__file__` 拼路径:后者在 zip 安装 / 打包成单文件时会失效,
而"读不到就静默空串"正是上面那条要防的形态。
"""
from __future__ import annotations

import re
from functools import lru_cache
from importlib import resources

__all__ = ["PromptAssetError", "load_section", "load_doc"]

_PKG = "windup_ai_engine.prompt.prompts"

# 节标题:一行 `## <名字>`。名字里不许有空格 —— 它是被代码按字面量索引的键,
# 不是给人读的标题;允许空格就会出现 "## side " 这种查不到的节。
_HEADING = re.compile(r"^##[ \t]+(\S+)[ \t]*$", re.MULTILINE)

# 提示词正文**必须**在围栏代码块里。
#
# 为什么不让它就是节下的散文(初版就是那样):散文与"原样送给模型的字面量"在页面上是同级
# 段落,看不出哪段是数据 —— 在 Python 里这两者本来靠语法分得清(docstring vs 字符串
# 字面量)。代码块把这个区分还回来:框里是数据、框外是说明,渲染出来也是等宽字体。
#
# 附带好处:折行规则从"猜哪些行算正文"退化成"框里的都算",不再需要启发式。
_FENCE = re.compile(r"^```[^\n]*\n(.*?)^```", re.S | re.M)


class PromptAssetError(RuntimeError):
    """提示词资产读不出来。**不是可以兜底的情形** —— 见模块 docstring。"""


@lru_cache(maxsize=None)
def load_doc(name: str) -> dict[str, str]:
    """读一份提示词 md,返回 ``{节名: 正文}``。

    节外的散文**不进返回值**:它是写给人看的说明,不该有任何可能混进送去生成的文本里。

    结果缓存:这些文件在进程生命周期内不变,而 ``build_*_prompt`` 每帧任务都会调。
    """
    try:
        raw = resources.files(_PKG).joinpath(name).read_text(encoding="utf-8")
    except (FileNotFoundError, ModuleNotFoundError, OSError) as e:
        raise PromptAssetError(
            f"读不到提示词资产 {_PKG}/{name}。它应随包发布(hatchling 默认收 packages 目录下"
            f"的全部文件);若是从 wheel 装的,先确认 md 真的打进去了。原始错误:{e!r}"
        ) from e

    marks = list(_HEADING.finditer(raw))
    if not marks:
        raise PromptAssetError(
            f"提示词资产 {name} 里一个 `## <节名>` 都没有。期望结构:文件开头是该动作的"
            "说明(散文),其后每个朝向一节如 `## side` / `## front`,"
            "每节下用一个 ```text 代码块装原样送给模型的提示词正文(英文)。"
        )
    out: dict[str, str] = {}
    for i, m in enumerate(marks):
        end = marks[i + 1].start() if i + 1 < len(marks) else len(raw)
        out[m.group(1)] = _fenced(raw[m.end():end], name, m.group(1))
    return out


def _fenced(block: str, doc: str, section: str) -> str:
    """取这一节代码块里的正文,压成送给模型的那一行。

    **只认代码块**,节里的散文一概不进返回值:那是写给人看的说明,一个字都不该混进
    付费调用的入参。没有代码块 = 空节,由 ``load_section`` 按 ``allow_empty`` 定夺
    (只有 ``master_poses`` 的"用中性站立母版即可"是合法的空)。

    折行:md 里为了可读按句子换行,而提示词是一整段散文;直接带着换行送出去,与校准过的
    那版就不是同一个字符串了。故框内各行折成空格连成一行。
    """
    fences = _FENCE.findall(block)
    if not fences:
        return ""
    if len(fences) > 1:
        raise PromptAssetError(
            f"{doc} 的 `## {section}` 节里有 {len(fences)} 个代码块。一节只能有一个 —— "
            "多个就得定「哪个才算正文」的规则,而那正是第二真相源的开头。"
        )
    return " ".join(ln.strip() for ln in fences[0].splitlines() if ln.strip())


def load_section(name: str, section: str, *, allow_empty: bool = False) -> str:
    """取某份 md 的某一节。

    ``allow_empty`` 只给**空本身就有含义**的地方用(如 ``MASTER_POSES`` 里"这个动作用
    中性站立母版即可")。默认不允许:空提示词会一路跑到付费调用,而没有任何一道会红。
    """
    doc = load_doc(name)
    if section not in doc:
        raise PromptAssetError(
            f"提示词资产 {name} 里没有 `## {section}` 这一节。现有:{sorted(doc)}"
        )
    text = doc[section]
    if not text and not allow_empty:
        raise PromptAssetError(
            f"提示词资产 {name} 的 `## {section}` 节是空的。空提示词会照常发出付费调用、"
            "产出垃圾、任务还显示成功 —— 故在此抛错。"
        )
    return text
