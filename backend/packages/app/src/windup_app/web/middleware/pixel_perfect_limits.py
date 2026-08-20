"""在 multipart 落盘前限制完美像素工具的请求体与并发。"""

import asyncio

from starlette.responses import JSONResponse
from windup_common.enums.biz_code import BizCode
from windup_common.result import Response


class _BodyTooLarge(Exception):
    pass


class PixelPerfectRequestLimitsMiddleware:
    def __init__(
        self,
        app,
        *,
        max_body_bytes: int = 11 * 1024 * 1024,
        max_concurrency: int = 1,
    ) -> None:
        if max_body_bytes < 1 or max_concurrency < 1:
            raise ValueError("pixel-perfect request limits must be positive")
        self.app = app
        self.max_body_bytes = max_body_bytes
        self.max_concurrency = max_concurrency
        self._active = 0
        self._lock = asyncio.Lock()

    async def __call__(self, scope, receive, send) -> None:
        if scope["type"] != "http" or not (
            scope["method"] == "POST" and scope["path"] == "/tools/pixel-perfect"
        ):
            await self.app(scope, receive, send)
            return

        async with self._lock:
            if self._active >= self.max_concurrency:
                await self._reject(
                    scope,
                    receive,
                    send,
                    "完美像素工具正在处理另一张图片",
                    BizCode.TOO_MANY_REQUESTS,
                )
                return
            self._active += 1

        received = 0

        async def bounded_receive():
            nonlocal received
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > self.max_body_bytes:
                    raise _BodyTooLarge
            return message

        try:
            await self.app(scope, bounded_receive, send)
        except _BodyTooLarge:
            await self._reject(
                scope,
                receive,
                send,
                "请求体不能超过 11 MB",
                BizCode.BAD_REQUEST,
            )
        finally:
            async with self._lock:
                self._active -= 1

    @staticmethod
    async def _reject(scope, receive, send, message: str, code: BizCode) -> None:
        response = JSONResponse(
            Response.fail(message, code=code).model_dump(mode="json")
        )
        await response(scope, receive, send)
