"""媒体上传服务——七牛 Kodo 对象存储实现。"""

from __future__ import annotations

from io import BytesIO
from uuid import uuid4

from PIL import Image

from windup_common.enums.media import MediaCategory
from windup_framework.config.storage import settings as storage_settings

from windup_app.server.media.interface import MediaService
from windup_app.server.media.model import MediaUploadInput, MediaUploadResult


class ObjectStorageMediaService(MediaService):
    """通过七牛 Kodo 对象存储上传媒体文件。

    配置来自 ``windup_framework.config.storage.settings``
    (环境变量前缀 ``QINIU_``)。
    """

    def upload(
        self,
        data: bytes,
        metadata: MediaUploadInput,
    ) -> MediaUploadResult:
        download_base = storage_settings.download_base
        suffix = _file_suffix(metadata.filename)
        marker = ".source" if metadata.category in _CARD_THUMBNAIL_CATEGORIES else ""
        object_key = f"media/{metadata.category}/{uuid4().hex}{marker}{suffix}"

        from qiniu import Auth, put_data

        auth = Auth(storage_settings.access_key, storage_settings.secret_key)
        thumbnail = None
        thumbnail_key = None
        if (
            metadata.category in _CARD_THUMBNAIL_CATEGORIES
            and metadata.content_type.startswith("image/")
        ):
            thumbnail_key = card_thumbnail_key(object_key)
            thumbnail = build_card_thumbnail(data)

        _put_object(auth, put_data, object_key, data, metadata.content_type)
        if thumbnail is not None and thumbnail_key is not None:
            try:
                _put_object(auth, put_data, thumbnail_key, thumbnail, "image/webp")
            except Exception:
                self.delete(object_key)
                raise

        url = f"{download_base}/{object_key}"
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
        _ret, resp = BucketManager(auth).delete(storage_settings.bucket_name, object_key)
        if resp.status_code not in {200, 612}:
            msg = f"七牛删除失败: status={resp.status_code}, body={resp.text}"
            raise RuntimeError(msg)


_CARD_THUMBNAIL_EDGE = 640
_CARD_THUMBNAIL_CATEGORIES = {
    MediaCategory.REFERENCE_IMAGE,
    MediaCategory.OUTFIT_PREVIEW,
}


def build_card_thumbnail(data: bytes) -> bytes:
    """生成不放大的无损 WebP 卡片图；透明像素和像素边缘都保留。"""
    with Image.open(BytesIO(data)) as source:
        has_alpha = source.mode in {"RGBA", "LA"} or "transparency" in source.info
        image = source.convert("RGBA" if has_alpha else "RGB")
        image.thumbnail(
            (_CARD_THUMBNAIL_EDGE, _CARD_THUMBNAIL_EDGE),
            Image.Resampling.NEAREST,
        )
        output = BytesIO()
        image.save(output, format="WEBP", lossless=True, method=6)
        return output.getvalue()


def card_thumbnail_key(object_key: str) -> str:
    """从带 ``.source`` 标记的新对象推导卡片图 key；历史对象不匹配。"""
    if object_key.endswith(".source"):
        source_stem = object_key
    else:
        stem, separator, _suffix = object_key.rpartition(".")
        source_stem = stem if separator else object_key
    if not source_stem.endswith(".source"):
        return object_key
    return f"{source_stem.removesuffix('.source')}.card.webp"


def _put_object(
    auth, put_data, object_key: str, data: bytes, content_type: str
) -> None:
    token = auth.upload_token(storage_settings.bucket_name, object_key)
    ret, resp = put_data(token, object_key, data, mime_type=content_type)
    if resp.status_code != 200 or ret is None:
        msg = f"七牛上传失败: status={resp.status_code}, body={resp.text}"
        raise RuntimeError(msg)


def _file_suffix(filename: str) -> str:
    """仅保留原始文件名后缀,避免把用户文件名写入对象 key。"""
    suffix = filename.rsplit(".", 1)
    if len(suffix) != 2 or not suffix[1]:
        return ""
    return f".{suffix[1].lower()}"


service = ObjectStorageMediaService()
