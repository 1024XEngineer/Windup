"""动作预设 API。

端点一览
--------
GET  /action-presets    列出全部动作预设(全量,不分页)

预设从 ``app.state`` 取而不是 import 进来:分层契约禁止 app.web 到 windup_ai_engine
的任何一条导入链(含经 server 中转的),而预设正住在 ai_engine 的提示词包里 ——
它的内容归那道措辞门禁管。装配在 bootstrap,与生成任务执行器同一套路。
"""

from fastapi import APIRouter, Request
from pydantic import BaseModel

from windup_common.result import ListResponse

router = APIRouter(prefix="/action-presets", tags=["action-presets"])


class ActionPresetOut(BaseModel):
    """动作预设响应。"""

    type: str
    label: str
    name: str
    description: str


@router.get("", response_model=ListResponse[ActionPresetOut])
def list_action_presets(request: Request) -> ListResponse[ActionPresetOut]:
    """列出全部动作预设。"""
    return ListResponse.success(
        [
            ActionPresetOut(
                type=preset.type.value,
                label=preset.label,
                name=preset.name,
                description=preset.description,
            )
            for preset in request.app.state.action_presets
        ]
    )
