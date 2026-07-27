"""文件上传 API。"""

import logging
import os
from uuid import uuid4

from fastapi import APIRouter, File, Request, UploadFile
from pydantic import BaseModel

from windup_common.enums.biz_code import BizCode
from windup_common.exceptions import BizException
from windup_common.result import Response
from windup_framework.storage import KodoStorage

logger = logging.getLogger("windup.upload.api")

router = APIRouter(prefix="/upload", tags=["upload"])
_storage = KodoStorage()

# 上传体积上限(字节),可用 WINDUP_MAX_UPLOAD_BYTES 覆盖,默认 10 MiB。
_DEFAULT_MAX_UPLOAD_BYTES = 10 * 1024 * 1024


def _max_upload_bytes() -> int:
    raw = os.getenv("WINDUP_MAX_UPLOAD_BYTES", "").strip()
    if raw.isdigit() and int(raw) > 0:
        return int(raw)
    return _DEFAULT_MAX_UPLOAD_BYTES


# 已校验 MIME -> 规范扩展名白名单(对象 key 只用白名单扩展名,防 key 注入)。
_MIME_TO_EXT = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
}


class ImageUploadOut(BaseModel):
    """图片上传结果。"""

    url: str


async def _read_capped(file: UploadFile, limit: int) -> bytes:
    """分块读取上传体,一旦超过 limit 立即中止,避免把超大体全量读入内存。"""
    chunks: list[bytes] = []
    total = 0
    while True:
        chunk = await file.read(1024 * 1024)
        if not chunk:
            break
        total += len(chunk)
        if total > limit:
            raise BizException(
                f"文件超过大小上限({limit} 字节)", code=BizCode.BAD_REQUEST
            )
        chunks.append(chunk)
    return b"".join(chunks)


@router.post("/image", response_model=Response[ImageUploadOut])
async def upload_image(
    request: Request, file: UploadFile = File(...)
) -> Response[ImageUploadOut]:
    """接收图片并上传至 Kodo,返回图片 URL。"""
    logger.info(
        "[WINDUP] 收到上传请求 | filename=%s content_type=%s",
        file.filename, file.content_type,
    )
    if not file.content_type or file.content_type not in _MIME_TO_EXT:
        logger.warning(
            "[WINDUP] 上传拒绝-非图片类型 | filename=%s content_type=%s",
            file.filename, file.content_type,
        )
        raise BizException("仅支持 jpg/png/webp/gif 图片", code=BizCode.BAD_REQUEST)

    limit = _max_upload_bytes()
    # 有 Content-Length 时先按声明体积早拒,省得白读一遍
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > limit:
        logger.warning(
            "[WINDUP] 上传拒绝-超大小上限 | declared=%s limit=%s", declared, limit
        )
        raise BizException(
            f"文件超过大小上限({limit} 字节)", code=BizCode.BAD_REQUEST
        )

    # 对象 key 只用白名单扩展名,不用攻击者可控的原始文件名后缀
    ext = _MIME_TO_EXT[file.content_type]
    key = f"projects/samples/{uuid4().hex}.{ext}"
    data = await _read_capped(file, limit)
    logger.info("[WINDUP] 开始上传至 Kodo | key=%s size=%s", key, len(data))
    try:
        url = _storage.upload(data, key, file.content_type)
    except RuntimeError as exc:
        logger.error("[WINDUP] Kodo 上传失败 | key=%s error=%s", key, exc)
        raise BizException("文件上传失败，请稍后重试", code=BizCode.INTERNAL_ERROR) from exc
    logger.info("[WINDUP] 上传完成 | url=%s", url)
    return Response.success(ImageUploadOut(url=url))
