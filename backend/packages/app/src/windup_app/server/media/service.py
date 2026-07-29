"""媒体上传服务的对象存储实现。"""

from __future__ import annotations

from typing import TYPE_CHECKING
from uuid import uuid4

from windup_app.server.media.interface import MediaService
from windup_app.server.media.model import MediaUploadInput, MediaUploadResult

if TYPE_CHECKING:
    from windup_framework.storage import KodoStorage


class ObjectStorageMediaService(MediaService):
    """使用对象存储适配器上传媒体文件。"""

    def __init__(self, storage: KodoStorage | None = None) -> None:
        self._storage = storage

    @property
    def storage(self) -> KodoStorage:
        if self._storage is None:
            from windup_framework.storage import KodoStorage

            self._storage = KodoStorage()
        return self._storage

    def upload(
        self,
        data: bytes,
        metadata: MediaUploadInput,
    ) -> MediaUploadResult:
        suffix = _file_suffix(metadata.filename)
        object_key = f"media/{metadata.category}/{uuid4().hex}{suffix}"
        url = self.storage.upload(data, object_key, metadata.content_type)
        return MediaUploadResult(
            url=url,
            object_key=object_key,
            filename=metadata.filename,
            content_type=metadata.content_type,
            size=metadata.size,
        )


def _file_suffix(filename: str) -> str:
    """仅保留原始文件名后缀,避免把用户文件名写入对象 key。"""
    suffix = filename.rsplit(".", 1)
    if len(suffix) != 2 or not suffix[1]:
        return ""
    return f".{suffix[1].lower()}"


service = ObjectStorageMediaService()
