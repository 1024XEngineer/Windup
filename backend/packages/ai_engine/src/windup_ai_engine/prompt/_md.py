"""提示词 markdown 的加载器。

正文住在 md 而不是 Python 常量:它是数据不是代码,改措辞不该动代码。

**缺文件 / 缺节 / 空节一律抛错。** 静默返回空串会让付费调用照常发出、产出垃圾、
任务还显示成功。
"""
from __future__ import annotations

import re
from functools import lru_cache
from importlib import resources

__all__ = ["PromptAssetError", "load_section", "load_doc"]

_PKG = "windup_ai_engine.prompt.prompts"

# 节名不许有空格:它是被代码按字面量索引的键。
_HEADING = re.compile(r"^##[ \t]+(\S+)[ \t]*$", re.MULTILINE)

# 正文必须在围栏代码块里,框外的是说明、不进产物。
_FENCE = re.compile(r"^```[^\n]*\n(.*?)^```", re.S | re.M)


class PromptAssetError(RuntimeError):
    """提示词资产读不出来。"""


@lru_cache(maxsize=None)
def load_doc(name: str) -> dict[str, str]:
    """读一份提示词 md,返回 ``{节名: 正文}``。"""
    try:
        raw = resources.files(_PKG).joinpath(name).read_text(encoding="utf-8")
    except (FileNotFoundError, ModuleNotFoundError, OSError) as e:
        raise PromptAssetError(f"读不到提示词资产 {_PKG}/{name}:{e!r}") from e

    marks = list(_HEADING.finditer(raw))
    if not marks:
        raise PromptAssetError(
            f"提示词资产 {name} 里一个 `## <节名>` 都没有。期望:每个朝向一节,"
            "节下用一个 ```text 代码块装正文。"
        )
    out: dict[str, str] = {}
    for i, m in enumerate(marks):
        end = marks[i + 1].start() if i + 1 < len(marks) else len(raw)
        out[m.group(1)] = _fenced(raw[m.end():end], name, m.group(1))
    return out


def _fenced(block: str, doc: str, section: str) -> str:
    """取代码块正文并折成一行。

    折行是因为 md 里按句子换行只为可读,带着换行送出去与校准过的那版就不是同一个字符串。
    """
    fences = _FENCE.findall(block)
    if not fences:
        return ""
    if len(fences) > 1:
        raise PromptAssetError(
            f"{doc} 的 `## {section}` 节里有 {len(fences)} 个代码块,只能有一个。"
        )
    return " ".join(ln.strip() for ln in fences[0].splitlines() if ln.strip())


def load_section(name: str, section: str, *, allow_empty: bool = False) -> str:
    """取某份 md 的某一节。

    ``allow_empty`` 只给空本身有含义的地方用(``MASTER_POSES``)。
    """
    doc = load_doc(name)
    if section not in doc:
        raise PromptAssetError(
            f"提示词资产 {name} 里没有 `## {section}` 这一节。现有:{sorted(doc)}"
        )
    text = doc[section]
    if not text and not allow_empty:
        raise PromptAssetError(f"提示词资产 {name} 的 `## {section}` 节是空的。")
    return text
