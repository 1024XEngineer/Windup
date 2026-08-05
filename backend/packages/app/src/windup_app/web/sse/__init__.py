"""SSE 模块:Server-Sent Events 通用推送基础设施。

- ``sse_router``: ``GET /sse/{channel}/stream`` 通用频道订阅端点
- ``EventBus``: 内存发布-订阅中心
- ``SSEProgressPort``: 后台线程 → EventBus 进度桥接
"""

from windup_app.web.sse.event_bus import EventBus, SSEEvent
from windup_app.web.sse.progress import SSEProgressPort
from windup_app.web.sse.stream import router as sse_router

__all__ = ["sse_router", "EventBus", "SSEEvent", "SSEProgressPort"]
