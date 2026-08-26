"""显式网格的完美像素化工具 API。"""

import asyncio

from fastapi import APIRouter, File, Form, UploadFile
from fastapi.responses import Response

from windup_app.server.pixel_perfect.reconstructor import (
    MAX_INPUT_BYTES,
    ReconstructorError,
    reconstruct_bytes,
)
from windup_common.enums.biz_code import BizCode
from windup_common.exceptions import BizException

router = APIRouter(prefix="/tools/pixel-perfect", tags=["pixel-perfect"])


@router.post("/reconstruct", response_class=Response)
async def reconstruct_pixel_grid(
    file: UploadFile = File(...),
    cols: int = Form(...),
    rows: int = Form(...),
    structure_colors: int = Form(16),
) -> Response:
    """按项目声明的精灵网格重建 PNG/JPEG，不执行网格猜测或资产写入。"""

    source = await file.read(MAX_INPUT_BYTES + 1)
    try:
        result = await asyncio.to_thread(
            reconstruct_bytes,
            source,
            cols,
            rows,
            structure_colors,
        )
    except ReconstructorError as error:
        raise BizException(str(error), code=BizCode.BAD_REQUEST) from error

    return Response(
        content=result.png,
        media_type="image/png",
        headers={
            "Content-Disposition": 'attachment; filename="pixel-perfect.png"',
            "X-Pixel-Cols": str(result.width),
            "X-Pixel-Rows": str(result.height),
            "X-Pixel-Visible-Colors": str(result.visible_color_count),
        },
    )
