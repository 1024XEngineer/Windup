"""SSE 模块:Server-Sent Events 实时推送（双模式）。

- ``sse_router``: Task mode —— 生成任务进度推送
- ``session_router``: Session mode —— Agent 多轮对话事件流
"""

from windup_app.web.sse.session import router as session_router
from windup_app.web.sse.stream import router as sse_router

__all__ = ["sse_router", "session_router"]
