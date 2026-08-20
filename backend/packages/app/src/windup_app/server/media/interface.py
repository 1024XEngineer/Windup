"""媒体上传领域服务接口。"""

from abc import ABC, abstractmethod

from windup_app.server.media.model import MediaUploadInput, MediaUploadResult


class MediaService(ABC):
    """文件上传用例的抽象边界。"""

    @abstractmethod
    def upload(
        self,
        data: bytes,
        metadata: MediaUploadInput,
    ) -> MediaUploadResult:
        """上传文件到对象存储并返回可回填业务数据的 URL。"""

    @abstractmethod
    def delete(self, object_key: str) -> None:
        """删除对象；对象已经不存在时视为成功。"""
