"""支付通知网关 API。

公开无鉴权端点，供第三方支付平台异步回调。
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, Request
from fastapi.responses import PlainTextResponse
from sqlalchemy.orm import Session

from windup_framework.db import get_session
from windup_app.server.bill.service import service as bill_service

logger = logging.getLogger("windup.bill.notify.api")

router = APIRouter(prefix="/bill/notify", tags=["bill_notify"])


@router.get("/epay")
@router.post("/epay")
async def epay_notify(
    request: Request,
    session: Session = Depends(get_session),
) -> PlainTextResponse:
    """易支付异步通知接收端点。"""
    if request.method == "GET":
        payload = dict(request.query_params)
    else:
        try:
            # 尝试按 form-urlencoded 解析，易支付默认为 form 表单格式
            form = await request.form()
            payload = dict(form)
        except Exception:
            # 如果不是 form 格式，尝试按 JSON 处理等（易支付通常是 form 或 GET query）
            payload = {}

    if not payload:
        logger.warning("[WINDUP] 收到的易支付回调 payload 为空")
        return PlainTextResponse("fail")

    logger.info("[WINDUP] 收到易支付回调 | payload=%s", payload)

    try:
        bill_service.handle_notify(session, payload)
        return PlainTextResponse("success")
    except Exception as e:
        logger.error(f"[WINDUP] 易支付回调处理失败: {e}", exc_info=True)
        # 通知处理失败，根据约定通常不返回 success
        return PlainTextResponse("fail")