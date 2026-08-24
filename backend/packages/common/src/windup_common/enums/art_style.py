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
    ArtStyle.REALISTIC: "painterly realism, no outlines, soft gradients and volumetric shading",
    ArtStyle.UNSPECIFIED: "",
}
