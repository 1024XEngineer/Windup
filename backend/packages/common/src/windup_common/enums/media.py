"""媒体文件相关枚举。"""

from enum import StrEnum


class MediaCategory(StrEnum):
    """上传文件的业务分类,用于生成对象存储 key 的目录。

    放在 common 而非 media 模块:新增文件用途时无需修改 media 代码。
    """

    REFERENCE_IMAGE = "reference-image"
    OUTFIT_PREVIEW = "outfit-preview"
    ACTION_FRAME = "action-frame"
    AVATAR = "avatar"
    # 造型的绑骨 3D 模型。**这个成员之前一直缺**,而 ``render3d_service._publish_model``
    # 一直按 ``"model-3d"`` 上传 —— 于是每次建 3D 资产都在图生 3D + 绑骨都付完之后
    # 撞 ValidationError:模型上传不出去、``outfits[].model_3d_url`` 永远是 None、
    # 三渲二那条路线在生产里一次都选不中。没有一处日志写着"分类不存在"。
    MODEL_3D = "model-3d"
    GENERAL = "general"
