"""独立完美像素工具 API；只接收文件并直接返回本地 PNG。"""

import asyncio

from fastapi import APIRouter, File, Form, Request, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel
from windup_common.enums.biz_code import BizCode
from windup_common.exceptions import BizException

from windup_app.server.pixel_perfect import (
    PixelPerfectBusyError,
    PixelPerfectInputError,
    PixelPerfectUnavailableError,
)


router = APIRouter(prefix="/tools", tags=["tools"])
MAX_UPLOAD_BYTES = 10 * 1024 * 1024
_SIGNATURES = {
    "image/png": b"\x89PNG\r\n\x1a\n",
    "image/jpeg": b"\xff\xd8\xff",
}


class ToolErrorResponse(BaseModel):
    code: int
    message: str
    data: object | None = None


@router.post(
    "/pixel-perfect",
    response_class=Response,
    responses={
        200: {
            "model": ToolErrorResponse,
            "content": {"image/png": {}},
        }
    },
)
async def pixel_perfect_file(
    request: Request,
    file: UploadFile = File(...),
    colors: int = Form(32, ge=2, le=64),
    pixel_size: float | None = Form(None, ge=1, allow_inf_nan=False),
) -> Response:
    """显式调用本地工具；不会被任何生成流程自动触发。"""
    signature = _SIGNATURES.get(file.content_type or "")
    if signature is None:
        raise BizException("当前只支持 PNG/JPEG 图片", code=BizCode.BAD_REQUEST)
    source = bytearray()
    while chunk := await file.read(64 * 1024):
        if len(source) + len(chunk) > MAX_UPLOAD_BYTES:
            raise BizException("图片不能超过 10 MB", code=BizCode.BAD_REQUEST)
        source.extend(chunk)
    if not source.startswith(signature):
        raise BizException("文件内容与声明的图片类型不匹配", code=BizCode.BAD_REQUEST)
    tool = getattr(request.app.state, "pixel_perfect_tool", None)
    if tool is None:
        raise BizException("完美像素工具未装配", code=BizCode.MODEL_UNAVAILABLE)
    try:
        result = await asyncio.to_thread(
            tool.process,
            bytes(source),
            colors=colors,
            pixel_size=pixel_size,
        )
    except PixelPerfectInputError as error:
        raise BizException(str(error), code=BizCode.BAD_REQUEST) from error
    except PixelPerfectBusyError as error:
        raise BizException(str(error), code=BizCode.TOO_MANY_REQUESTS) from error
    except PixelPerfectUnavailableError as error:
        raise BizException(str(error), code=BizCode.MODEL_UNAVAILABLE) from error
    return Response(
        content=result.png,
        media_type="image/png",
        headers={
            "Content-Disposition": 'attachment; filename="pixel-perfect.png"',
            "X-Pixel-Cols": str(result.cols),
            "X-Pixel-Rows": str(result.rows),
            "X-Pixel-Step-X": str(result.step_x),
            "X-Pixel-Step-Y": str(result.step_y),
            "X-Pixel-Consensus": result.consensus,
            "X-Pixel-Confidence": result.confidence,
        },
    )
