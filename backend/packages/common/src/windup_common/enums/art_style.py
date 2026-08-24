"""项目画风枚举。"""

from enum import Enum


class ArtStyle(str, Enum):
    """项目的美术风格。

    只有 ``PIXEL`` 改变管线行为(出帧吸附母版像素网格、颜色吸回母版色板),其余取值
    只进提示词。像素网格密度不在这一维 —— 它由目标分辨率定,两处各定一遍会打架。

    展示名与进提示词的短语不在这里,在 :mod:`windup_ai_engine.prompt.art_styles`:
    那是提示词内容,归措辞门禁管;本枚举只定管线契约,不该随文案一起改。
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
