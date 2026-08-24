"""画风预设 API。

端点一览
--------
GET  /art-styles    列出全部画风档位(全量,不分页)

预设从 ``app.state`` 取而不是 import 进来:分层契约禁止 app.web 到 windup_ai_engine
的任何一条导入链,而预设正住在 ai_engine 的提示词包里。装配在 bootstrap,与动作预设同一套路。
"""

from fastapi import APIRouter, Request
from pydantic import BaseModel

from windup_common.result import ListResponse

router = APIRouter(prefix="/art-styles", tags=["art-styles"])


class ArtStyleOut(BaseModel):
    """画风档位响应。``phrase`` 不出网:它是提示词内容,前端拿了只会诱发再抄一份。"""

    code: str
    label: str
    hint: str


@router.get("", response_model=ListResponse[ArtStyleOut])
def list_art_styles(request: Request) -> ListResponse[ArtStyleOut]:
    """列出全部画风档位。"""
    return ListResponse.success(
        [
            ArtStyleOut(code=preset.style.value, label=preset.label, hint=preset.hint)
            for preset in request.app.state.art_style_presets
        ]
    )
