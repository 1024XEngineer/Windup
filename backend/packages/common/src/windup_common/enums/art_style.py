"""项目画风枚举。"""

from enum import Enum


class ArtStyle(str, Enum):
    """项目的美术风格。

    只有 ``PIXEL`` 改变管线行为(出帧吸附母版像素网格、颜色吸回母版色板),其余取值
    只进提示词。像素网格密度不在这一维 —— 它由目标分辨率定,两处各定一遍会打架。
    """

    PIXEL = "pixel"
    CARTOON = "cartoon"
    HAND_DRAWN = "hand_drawn"
    REALISTIC = "realistic"
    UNSPECIFIED = "unspecified"

    @property
    def wants_pixelation(self) -> bool:
        """出帧要不要走像素化后处理。"""
        return self is ArtStyle.PIXEL

    @property
    def prompt_phrase(self) -> str:
        """进生成提示词的英文短语;``UNSPECIFIED`` 返回空串表示不加这一句。

        三种非像素画风在管线里同走一条路,分开的理由是用户一眼可辨:卡通有粗描线平涂、
        手绘有笔触、写实无描线走渐变。短语必须把这个差别说出来,否则分档形同虚设。
        """
        return _PROMPT_PHRASES[self]

    @classmethod
    def phrase_from_stored(cls, value: str | None) -> str:
        """库里那一列该往提示词里放什么。

        存量项目存的是自由文本(如「中世纪厚涂」),枚举化之前它是原样进提示词的。
        把它一律归到 ``UNSPECIFIED`` 会静默抹掉用户已有的画风约束,而帧数、时长、
        成色全都正常,没有一处会红 —— 所以认不出的取值原样交出去。
        """
        if not value:
            return ""
        text = value.strip()
        try:
            return cls(text).prompt_phrase
        except ValueError:
            return text

    @classmethod
    def from_stored(cls, value: str | None) -> "ArtStyle":
        """把库里的画风字段读成枚举。

        存量项目存的是不受限的自由文本,按枚举严格解析会让它们全部落到 ``UNSPECIFIED``、
        静默丢掉像素化 —— 而帧数、时长、成色全都正常,没有一处会红。
        """
        if not value:
            return cls.UNSPECIFIED
        text = value.strip()
        try:
            return cls(text)
        except ValueError:
            pass
        return cls.PIXEL if ("pixel" in text.lower() or "像素" in text) else cls.UNSPECIFIED


_PROMPT_PHRASES = {
    ArtStyle.PIXEL: "pixel art",
    ArtStyle.CARTOON: "cartoon, bold clean outlines, flat cel shading",
    ArtStyle.HAND_DRAWN: "hand-drawn illustration, visible brush strokes, textured paper",
    # 不写「no outlines」:这条通路没有 negative_prompt,模型不处理否定极性、只把名词
    # latch 进画面,写「不要 X」等于点名要 X(与 ai_engine.prompt.lint 的否定式规则同一机制)。
    ArtStyle.REALISTIC: (
        "painterly realism, forms defined by light and shadow, "
        "soft gradients and volumetric shading"
    ),
    ArtStyle.UNSPECIFIED: "",
}
