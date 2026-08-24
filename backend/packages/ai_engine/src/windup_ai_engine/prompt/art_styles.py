"""画风预设 —— 档位的展示名与进提示词的英文短语。

**这里是唯一真相源。** 短语随请求进到母版那张静态图(``/generation/image`` 的
``prompt``),写在前端的副本既会与后端漂移,又整条绕开 :mod:`windup_ai_engine.prompt.lint`
的措辞门禁 —— 与 :mod:`windup_ai_engine.prompt.presets` 同一个理由。

档位本身(有哪些 code、哪个触发像素化)是 :class:`~windup_common.enums.ArtStyle`
的事,不在这里定:那是管线契约,不该随文案一起改。
"""
from __future__ import annotations

from dataclasses import dataclass

from windup_common.enums import ArtStyle

__all__ = ["ArtStylePreset", "ART_STYLE_PRESETS", "phrase_for"]


@dataclass(frozen=True)
class ArtStylePreset:
    """``label`` / ``hint`` 只用于菜单展示,``phrase`` 才进提示词。

    ``hint`` 是必要的:用户选画风时看不到管线,不把差别说出来的话几个档位对他是等价的。
    """

    style: ArtStyle
    label: str
    hint: str
    phrase: str


# 三种非像素画风在管线里同走一条路(stylize=none),分开的唯一理由是用户一眼可辨,
# 所以短语必须把那个可辨的差别说出来,否则分档形同虚设。
ART_STYLE_PRESETS: tuple[ArtStylePreset, ...] = (
    ArtStylePreset(
        style=ArtStyle.PIXEL,
        label="像素",
        hint="出帧吸附母版像素网格，颜色吸回母版色板",
        phrase="pixel art",
    ),
    ArtStylePreset(
        style=ArtStyle.CARTOON,
        label="卡通",
        hint="粗描线、平涂",
        phrase="cartoon, bold clean outlines, flat cel shading",
    ),
    ArtStylePreset(
        style=ArtStyle.HAND_DRAWN,
        label="手绘",
        hint="有笔触与纸纹",
        phrase="hand-drawn illustration, visible brush strokes, textured paper",
    ),
    ArtStylePreset(
        style=ArtStyle.REALISTIC,
        label="写实",
        hint="靠光影塑形，走渐变与体积光",
        # 不写「no outlines」:这条通路没有 negative_prompt,否定式只会把 outlines
        # latch 进画面(lint 规则 1)。改成正面说形体靠什么定义。
        phrase=(
            "painterly realism, forms defined by light and shadow, "
            "soft gradients and volumetric shading"
        ),
    ),
    ArtStylePreset(
        style=ArtStyle.UNSPECIFIED,
        label="不指定",
        hint="不给模型画风约束",
        phrase="",
    ),
)

_BY_STYLE = {preset.style: preset for preset in ART_STYLE_PRESETS}


def phrase_for(style: ArtStyle) -> str:
    """该档位进提示词的短语;``UNSPECIFIED`` 返回空串表示不加这一句。"""
    return _BY_STYLE[style].phrase
