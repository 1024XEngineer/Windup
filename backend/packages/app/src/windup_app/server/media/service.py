"""媒体上传 / 删除服务——七牛 Kodo 对象存储实现。"""

from __future__ import annotations

from uuid import uuid4

from windup_framework.config.storage import settings as storage_settings

from windup_app.server.media.interface import MediaService
from windup_app.server.media.model import MediaUploadInput, MediaUploadResult


class ObjectStorageMediaService(MediaService):
    """通过七牛 Kodo 对象存储上传 / 删除媒体文件。

    配置来自 ``windup_framework.config.storage.settings``
    (环境变量前缀 ``QINIU_``)。
    """

    def upload(
        self,
        data: bytes,
        metadata: MediaUploadInput,
    ) -> MediaUploadResult:
        from qiniu import Auth, put_data

        suffix = _file_suffix(metadata.filename)
        object_key = f"media/{metadata.category}/{uuid4().hex}{suffix}"

        auth = Auth(storage_settings.access_key, storage_settings.secret_key)
        token = auth.upload_token(storage_settings.bucket_name, object_key)
        ret, resp = put_data(token, object_key, data, mime_type=metadata.content_type)
        if resp.status_code != 200 or ret is None:
            msg = f"七牛上传失败: status={resp.status_code}, body={resp.text}"
            raise RuntimeError(msg)

        url = f"{storage_settings.download_base}/{object_key}"
        return MediaUploadResult(
            url=url,
            object_key=object_key,
            filename=metadata.filename,
            content_type=metadata.content_type,
            size=metadata.size,
        )

    def delete(self, object_key: str) -> None:
        from qiniu import Auth, BucketManager

        auth = Auth(storage_settings.access_key, storage_settings.secret_key)
        manager = BucketManager(auth)
        ret, resp = manager.delete(storage_settings.bucket_name, object_key)
        if resp.status_code != 200:
            msg = f"七牛删除失败: status={resp.status_code}, body={resp.text}"
            raise RuntimeError(msg)


def _file_suffix(filename: str) -> str:
    """仅保留原始文件名后缀,避免把用户文件名写入对象 key。"""
    suffix = filename.rsplit(".", 1)
    if len(suffix) != 2 or not suffix[1]:
        return ""
    return f".{suffix[1].lower()}"


service = ObjectStorageMediaService()
