"""提示词 markdown 的加载器。

为什么提示词正文住在 markdown 而不是 Python 字符串常量(#233):这几个文件**七成是理由、
三成是代码** —— 为什么只写正向词、为什么提示词朝向必须与母版一致、装备名词为什么不能进
模板(#195),这些是拿钱和时间换来的实测记录,而它们原先挤在 Python 隐式字符串拼接之间,
改一个词的 diff 全是噪声。搬进 md 之后:理由与正文在一起,Python 只留加载与按 facing 分流。

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


class PromptAssetError(RuntimeError):
    """提示词资产读不出来。**不是可以兜底的情形** —— 见模块 docstring。"""


@lru_cache(maxsize=None)
def load_doc(name: str) -> dict[str, str]:
    """读一份提示词 md,返回 ``{节名: 正文}``。

    节外的散文(每个文件开头那段实测理由)**不进返回值**:它是写给人看的,不该有任何
    可能混进送去生成的文本里。

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
            "实测理由(散文),其后每个朝向一节,如 `## side` / `## front`。"
        )
    out: dict[str, str] = {}
    for i, m in enumerate(marks):
        end = marks[i + 1].start() if i + 1 < len(marks) else len(raw)
        out[m.group(1)] = _flatten(raw[m.end():end])
    return out


def _flatten(block: str) -> str:
    """把一节的正文压成送给模型的那一行。

    md 里为了可读按句子换行,而提示词是一整段散文;直接带着换行送出去,与实测通过的那版
    就不是同一个字符串了。规则:去掉注释行(`> ` 引用块留给写理由用)、空行分段、
    段内换行折成空格,段与段之间用一个空格接上。
    """
    lines = [ln.strip() for ln in block.splitlines()]
    kept = [ln for ln in lines if ln and not ln.startswith(">")]
    return " ".join(kept)


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
