"""文件上传 API。"""

import logging
from uuid import uuid4

from fastapi import APIRouter, File, UploadFile
from pydantic import BaseModel

from windup_common.enums.biz_code import BizCode
from windup_common.exceptions import BizException
from windup_common.result import Response
from windup_framework.storage import KodoStorage

logger = logging.getLogger("windup.upload.api")

router = APIRouter(prefix="/upload", tags=["upload"])
_storage = KodoStorage()


class ImageUploadOut(BaseModel):
    """图片上传结果。"""

    url: str


@router.post("/image", response_model=Response[ImageUploadOut])
async def upload_image(file: UploadFile = File(...)) -> Response[ImageUploadOut]:
    """接收图片并上传至 Kodo,返回图片 URL。"""
    logger.info(
        "[WINDUP] 收到上传请求 | filename=%s content_type=%s",
        file.filename, file.content_type,
    )
    if not file.content_type or not file.content_type.startswith("image/"):
        logger.warning(
            "[WINDUP] 上传拒绝-非图片类型 | filename=%s content_type=%s",
            file.filename, file.content_type,
        )
        raise BizException("仅支持图片文件", code=BizCode.BAD_REQUEST)

    suffix = (
        file.filename.rsplit(".", 1)[-1].lower()
        if file.filename and "." in file.filename
        else "bin"
    )
    key = f"projects/samples/{uuid4().hex}.{suffix}"
    data = await file.read()
    logger.info("[WINDUP] 开始上传至 Kodo | key=%s size=%s", key, len(data))
    try:
        url = _storage.upload(data, key, file.content_type)
    except RuntimeError as exc:
        logger.error("[WINDUP] Kodo 上传失败 | key=%s error=%s", key, exc)
        raise BizException("文件上传失败，请稍后重试", code=BizCode.INTERNAL_ERROR) from exc
    logger.info("[WINDUP] 上传完成 | url=%s", url)
    return Response.success(ImageUploadOut(url=url))
