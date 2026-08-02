"""媒体文件相关枚举。"""

from enum import StrEnum


class MediaCategory(StrEnum):
    """上传文件的业务分类,用于生成对象存储 key 的目录。

    放在 common 而非 media 模块:新增文件用途时无需修改 media 代码。
    """

    REFERENCE_IMAGE = "reference-image"
    OUTFIT_PREVIEW = "outfit-preview"
    ACTION_FRAME = "action-frame"
    GENERAL = "general"
