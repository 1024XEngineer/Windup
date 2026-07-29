"""媒体文件领域模型。

媒体模块负责把前端上传的文件写入对象存储,并向调用方返回可保存到业务
数据(例如 ``Character.reference_image_url`` / ``character_data``)中的 URL。
媒体记录本身不与角色表耦合;同一个上传服务可处理参考图、造型预览图和动作帧。
"""

from pydantic import BaseModel, Field

from windup_common.enums.media import MediaCategory


class MediaUploadInput(BaseModel):
    """待上传文件的元信息。

    文件二进制内容由 service 方法单独接收;该模型只保存前端文件信息和
    业务分类,避免把 ``UploadFile`` 这类 FastAPI 类型泄漏到 server 层。
    """

    filename: str = Field(min_length=1, max_length=255, description="前端原始文件名")
    content_type: str = Field(min_length=1, max_length=100, description="MIME 类型")
    size: int = Field(ge=0, description="文件大小(字节)")
    category: MediaCategory = Field(
        default=MediaCategory.GENERAL,
        description="文件业务分类",
    )


class MediaUploadResult(BaseModel):
    """对象存储上传结果,前端使用 ``url`` 回填角色数据。"""

    url: str = Field(description="对象存储公开访问 URL")
    object_key: str = Field(description="对象存储中的对象 key")
    filename: str = Field(description="原始文件名")
    content_type: str = Field(description="MIME 类型")
    size: int = Field(ge=0, description="文件大小(字节)")
