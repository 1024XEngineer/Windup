"""角色资产状态枚举。"""

from enum import IntEnum


class CharacterStatus(IntEnum):
    """角色发布状态。

    - ``DRAFT (0)``: 草稿——尚无真实动作帧。
    - ``PUBLISHED (1)``: 已发布——至少存在一条包含真实帧的动作。
    """

    DRAFT = 0
    PUBLISHED = 1

    @classmethod
    def from_character_data(cls, character_data: dict) -> "CharacterStatus":
        """根据 character_data 推断发布状态。

        判定规则：动作顶层或任一方向序列包含真实帧即为已发布；否则为草稿。
        """
        for outfit in character_data.get("outfits", []):
            for action in outfit.get("actions", []):
                frames = action.get("frames", [])
                if frames and action.get("frame_count", 0) > 0:
                    return cls.PUBLISHED
                for sequence in action.get("sequences", []):
                    frames = sequence.get("frames", [])
                    if frames and sequence.get("frame_count", 0) > 0:
                        return cls.PUBLISHED
        return cls.DRAFT
