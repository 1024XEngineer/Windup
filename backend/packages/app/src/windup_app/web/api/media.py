"""媒体文件上传 API。"""

from fastapi import APIRouter, File, UploadFile

from windup_common.enums.biz_code import BizCode
from windup_common.exceptions import BizException
from windup_common.result import Response

from windup_app.server.media.model import MediaCategory, MediaUploadInput, MediaUploadResult
from windup_app.server.media.service import service

router = APIRouter(prefix="/media", tags=["media"])


@router.post("/upload", response_model=Response[MediaUploadResult])
async def upload_media(
    file: UploadFile = File(...),
    category: MediaCategory = MediaCategory.GENERAL,
) -> Response[MediaUploadResult]:
    """接收前端文件并上传对象存储,返回 URL。"""
    if not file.content_type or not file.content_type.startswith("image/"):
        raise BizException("仅支持图片文件", code=BizCode.BAD_REQUEST)

    data = await file.read()
    metadata = MediaUploadInput(
        filename=file.filename or "upload",
        content_type=file.content_type,
        size=len(data),
        category=category,
    )
    result = service.upload(data, metadata)
    return Response.success(result)
