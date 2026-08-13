"""媒体文件上传 API。"""

import asyncio

from fastapi import APIRouter, File, UploadFile

from windup_common.enums.biz_code import BizCode
from windup_common.exceptions import BizException
from windup_common.result import Response

from windup_app.server.media.model import MediaCategory, MediaUploadInput, MediaUploadResult
from windup_app.server.media.service import service

router = APIRouter(prefix="/media", tags=["media"])

# 允许的 MIME 类型白名单（精确匹配，不接受通配符子类型）
_ALLOWED_IMAGE_TYPES: set[str] = {
    "image/png",
    "image/jpeg",
    "image/gif",
    "image/webp",
}
_ALLOWED_MODEL_TYPES: set[str] = {
    "model/gltf-binary",
    "model/gltf+json",
}
_ALLOWED_TYPES = _ALLOWED_IMAGE_TYPES | _ALLOWED_MODEL_TYPES

# 大小限制（按类型分组）
_IMAGE_SIZE_LIMIT = 10 * 1024 * 1024    # 10 MB
_MODEL_SIZE_LIMIT = 80 * 1024 * 1024    # 80 MB

# 图片 magic bytes 校验表
# WebP 需要额外检查 bytes 8-11 为 "WEBP"，单独处理
_IMAGE_SIGNATURES: dict[str, bytes] = {
    "image/png": b"\x89PNG\r\n\x1a\n",
    "image/jpeg": b"\xff\xd8\xff",
    "image/gif": b"GIF8",    # GIF87a 和 GIF89a 都以 GIF8 开头
}
_WEBP_RIFF_PREFIX = b"RIFF"
_WEBP_MARKER = b"WEBP"  # bytes 8-11


def _get_size_limit(content_type: str) -> int:
    """根据 content_type 返回对应的大小限制。"""
    if content_type in _ALLOWED_MODEL_TYPES:
        return _MODEL_SIZE_LIMIT
    return _IMAGE_SIZE_LIMIT


def _validate_image_magic(data: bytes, content_type: str) -> bool:
    """校验文件头 magic bytes 是否与声明的 content_type 匹配。

    仅允许 _ALLOWED_IMAGE_TYPES 中的类型，未知类型直接拒绝。
    """
    # WebP 需要同时检查 RIFF 前缀和 WEBP 标记（bytes 8-11）
    if content_type == "image/webp":
        return (
            len(data) >= 12
            and data[:4] == _WEBP_RIFF_PREFIX
            and data[8:12] == _WEBP_MARKER
        )
    expected = _IMAGE_SIGNATURES.get(content_type)
    if expected is None:
        return False
    return data[: len(expected)] == expected


@router.post("/upload", response_model=Response[MediaUploadResult])
async def upload_media(
    file: UploadFile = File(...),
    category: MediaCategory = MediaCategory.GENERAL,
) -> Response[MediaUploadResult]:
    """接收前端文件并上传对象存储,返回 URL。"""
    if not file.content_type:
        raise BizException("缺少 content_type", code=BizCode.BAD_REQUEST)

    if file.content_type not in _ALLOWED_TYPES:
        raise BizException(
            f"不支持的文件类型: {file.content_type}",
            code=BizCode.BAD_REQUEST,
        )

    # 根据 content_type 确定大小限制
    size_limit = _get_size_limit(file.content_type)

    # 分块读取并校验大小，避免一次性读入大文件导致 OOM
    # 使用 bytearray 原地扩展，避免 chunks 列表 + join 的双倍内存开销
    data = bytearray()
    while True:
        chunk = await file.read(64 * 1024)  # 64 KB per chunk
        if not chunk:
            break
        if len(data) + len(chunk) > size_limit:
            raise BizException(
                f"文件大小超过限制（最大 {size_limit // 1024 // 1024} MB）",
                code=BizCode.BAD_REQUEST,
            )
        data.extend(chunk)

    # 图片类型做 magic bytes 校验
    if file.content_type in _ALLOWED_IMAGE_TYPES:
        if not _validate_image_magic(data, file.content_type):
            raise BizException("文件内容与声明的类型不匹配", code=BizCode.BAD_REQUEST)

    metadata = MediaUploadInput(
        filename=file.filename or "upload",
        content_type=file.content_type,
        size=len(data),
        category=category,
    )

    # 同步上传放到线程池，避免阻塞事件循环
    result = await asyncio.to_thread(service.upload, data, metadata)
    return Response.success(result)
