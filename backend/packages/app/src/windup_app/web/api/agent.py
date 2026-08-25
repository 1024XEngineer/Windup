"""Authenticated OpenAI-compatible chat proxy for the frontend Agent.

This endpoint owns only the paid model boundary: server-side provider settings,
request limits and response translation. It does not store conversations,
execute Tool Calls or touch workflow state.
"""

from __future__ import annotations

import json
import logging
import time
from collections.abc import Awaitable, Callable
from typing import Any, Literal
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, Response
from fastapi.routing import APIRoute
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, ConfigDict, Field

from windup_framework.config.provider import settings as provider_settings
from windup_framework.gateway import bind_call_context

logger = logging.getLogger("windup.ai.proxy")
REQUEST_ID_HEADER = "X-Request-Id"


class RequestTooLargeError(HTTPException):
    """Raised while counting a chunked request before JSON parsing."""

    def __init__(self) -> None:
        super().__init__(status_code=413, detail="请求体超过 64 KiB 上限")


class OpenAICompatibleRoute(APIRoute):
    """Keep this protocol endpoint out of the app's HTTP-200 error envelope."""

    def get_route_handler(self) -> Callable[[Request], Awaitable[Response]]:
        original = super().get_route_handler()

        async def route_handler(request: Request) -> Response:
            content_length = request.headers.get("content-length")
            if content_length is not None:
                try:
                    if int(content_length) > MAX_REQUEST_BYTES:
                        return _error_response(
                            413,
                            message="请求体超过 64 KiB 上限",
                            error_type="invalid_request_error",
                            code="request_too_large",
                        )
                except ValueError:
                    pass

            received = 0
            receive = request._receive

            async def limited_receive():
                nonlocal received
                message = await receive()
                if message["type"] == "http.request":
                    received += len(message.get("body", b""))
                    if received > MAX_REQUEST_BYTES:
                        raise RequestTooLargeError
                return message

            request._receive = limited_receive
            try:
                return await original(request)
            except RequestTooLargeError:
                return _error_response(
                    413,
                    message="请求体超过 64 KiB 上限",
                    error_type="invalid_request_error",
                    code="request_too_large",
                )
            except RequestValidationError:
                return _error_response(
                    422,
                    message="请求参数无效",
                    error_type="invalid_request_error",
                    code="invalid_request",
                )

        return route_handler


router = APIRouter(prefix="/ai", tags=["ai"], route_class=OpenAICompatibleRoute)
bearer_scheme = HTTPBearer(auto_error=False)

MAX_REQUEST_BYTES = 64 * 1_024
MAX_MESSAGES = 16
MAX_MESSAGE_CHARS = 8_000
MAX_OUTPUT_TOKENS = 1_024


class ChatMessage(BaseModel):
    """One OpenAI-compatible message kept by the browser."""

    model_config = ConfigDict(extra="forbid")

    role: Literal["system", "user", "assistant", "tool"]
    content: str | None = Field(default=None, max_length=MAX_MESSAGE_CHARS)
    tool_calls: list[dict[str, Any]] | None = Field(default=None, max_length=1)
    tool_call_id: str | None = Field(default=None, max_length=128)


class FunctionDefinition(BaseModel):
    """Schema-only function definition forwarded to the model provider."""

    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=64)
    description: str | None = Field(default=None, max_length=1_000)
    parameters: dict[str, Any]
    strict: bool | None = None


class ToolDefinition(BaseModel):
    """Only OpenAI function tools are accepted; the backend never executes them."""

    model_config = ConfigDict(extra="forbid")

    type: Literal["function"] = "function"
    function: FunctionDefinition


class ChatRequest(BaseModel):
    """Bounded subset of Chat Completions used by AI SDK Core."""

    # AI SDK may send provider options such as max_tokens. Cost-bearing fields
    # are intentionally ignored and replaced with server-owned values below.
    model_config = ConfigDict(extra="ignore")

    model: str | None = Field(default=None, max_length=128)
    messages: list[ChatMessage] = Field(min_length=1, max_length=MAX_MESSAGES)
    tools: list[ToolDefinition] | None = Field(default=None, max_length=1)
    tool_choice: Literal["auto", "none", "required"] | None = None
    temperature: float | None = Field(default=None, ge=0, le=2)
    stream: Literal[False] = False


class FunctionCallResponse(BaseModel):
    name: str
    arguments: str


class ToolCallResponse(BaseModel):
    id: str
    type: Literal["function"] = "function"
    function: FunctionCallResponse


class AssistantMessageResponse(BaseModel):
    role: Literal["assistant"] = "assistant"
    content: str | None
    tool_calls: list[ToolCallResponse] | None = None


class ChatChoiceResponse(BaseModel):
    index: int = 0
    message: AssistantMessageResponse
    finish_reason: str


class ChatUsageResponse(BaseModel):
    prompt_tokens: int
    completion_tokens: int
    total_tokens: int


class ChatCompletionResponse(BaseModel):
    id: str
    object: Literal["chat.completion"] = "chat.completion"
    created: int
    model: str
    choices: list[ChatChoiceResponse]
    usage: ChatUsageResponse | None = None


class OpenAIErrorDetail(BaseModel):
    message: str
    type: str
    code: str


class OpenAIErrorResponse(BaseModel):
    error: OpenAIErrorDetail


def _error_response(
    status_code: int,
    *,
    message: str,
    error_type: str,
    code: str,
    request_id: str | None = None,
) -> JSONResponse:
    response = JSONResponse(
        status_code=status_code,
        content={"error": {"message": message, "type": error_type, "code": code}},
    )
    if request_id:
        response.headers[REQUEST_ID_HEADER] = request_id
    return response


def _completion_response(
    payload: ChatCompletionResponse, request_id: str
) -> JSONResponse:
    response = JSONResponse(content=payload.model_dump(mode="json"))
    response.headers[REQUEST_ID_HEADER] = request_id
    return response


def _exc_text(exc: BaseException, limit: int = 500) -> str:
    return (str(exc).strip() or type(exc).__name__)[:limit]


def _serialize_tool_calls(result: Any) -> list[ToolCallResponse] | None:
    if result.invalid_tool_calls:
        raise ValueError("provider returned an invalid Tool Call")
    if not result.tool_calls:
        return None

    calls: list[ToolCallResponse] = []
    for call in result.tool_calls:
        call_id = call.get("id")
        name = call.get("name")
        arguments = call.get("args")
        if not isinstance(call_id, str) or not isinstance(name, str):
            raise ValueError("provider returned an incomplete Tool Call")
        if not isinstance(arguments, dict):
            raise ValueError("provider returned invalid Tool arguments")
        calls.append(
            ToolCallResponse(
                id=call_id,
                function=FunctionCallResponse(
                    name=name,
                    arguments=json.dumps(
                        arguments,
                        ensure_ascii=False,
                        separators=(",", ":"),
                    ),
                ),
            )
        )
    return calls


def _serialize_completion(result: Any, fallback_model: str) -> ChatCompletionResponse:
    tool_calls = _serialize_tool_calls(result)
    content = result.content
    if not isinstance(content, str):
        raise ValueError("provider returned non-text chat content")

    metadata = result.response_metadata
    finish_reason = metadata.get("finish_reason") or (
        "tool_calls" if tool_calls else "stop"
    )
    upstream_id = metadata.get("id")
    model_name = metadata.get("model_name") or fallback_model
    usage = result.usage_metadata

    return ChatCompletionResponse(
        id=str(upstream_id or result.id or f"chatcmpl-{uuid4().hex}"),
        created=int(time.time()),
        model=str(model_name),
        choices=[
            ChatChoiceResponse(
                message=AssistantMessageResponse(
                    content=content or None if tool_calls else content,
                    tool_calls=tool_calls,
                ),
                finish_reason=str(finish_reason),
            )
        ],
        usage=(
            ChatUsageResponse(
                prompt_tokens=usage["input_tokens"],
                completion_tokens=usage["output_tokens"],
                total_tokens=usage["total_tokens"],
            )
            if usage
            else None
        ),
    )


@router.post(
    "/chat",
    response_model=ChatCompletionResponse,
    responses={
        401: {"model": OpenAIErrorResponse},
        413: {"model": OpenAIErrorResponse},
        422: {"model": OpenAIErrorResponse},
        502: {"model": OpenAIErrorResponse},
        503: {"model": OpenAIErrorResponse},
    },
)
async def chat(
    body: ChatRequest,
    request: Request,
    _credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
):
    """Call the configured model once and return a non-streaming completion."""
    request_id = str(uuid4())
    user_id = request.state.current_user.id
    proxy_settings = provider_settings.model_copy(update={"max_retries": 0})
    model_kwargs: dict[str, Any] = {"max_tokens": MAX_OUTPUT_TOKENS}
    if body.temperature is not None:
        model_kwargs["temperature"] = body.temperature

    try:
        model = request.app.state.chat_model_factory(proxy_settings, **model_kwargs)
    except ValueError:
        logger.warning(
            "AI chat not configured request_id=%s user_id=%s", request_id, user_id
        )
        return _error_response(
            503,
            message="AI 服务未配置",
            error_type="service_unavailable",
            code="ai_not_configured",
            request_id=request_id,
        )

    logger.info(
        "AI chat started request_id=%s user_id=%s messages=%s tools=%s",
        request_id,
        user_id,
        len(body.messages),
        0 if not body.tools else len(body.tools),
    )
    invoke_kwargs: dict[str, Any] = {}
    if body.tools:
        invoke_kwargs["tools"] = [
            tool.model_dump(exclude_none=True) for tool in body.tools
        ]
    if body.tool_choice is not None:
        invoke_kwargs["tool_choice"] = body.tool_choice

    started = time.monotonic()
    reset = bind_call_context(request_id=request_id, user_id=str(user_id))
    try:
        result = await model.ainvoke(
            [message.model_dump(exclude_none=True) for message in body.messages],
            **invoke_kwargs,
        )
    except Exception as exc:
        logger.warning(
            "AI chat upstream failed request_id=%s user_id=%s error_type=%s error=%s",
            request_id,
            user_id,
            type(exc).__name__,
            _exc_text(exc),
        )
        return _error_response(
            502,
            message="AI 服务暂时不可用",
            error_type="upstream_error",
            code="ai_upstream_error",
            request_id=request_id,
        )
    finally:
        reset()

    try:
        configured_model = (
            proxy_settings.chat_model or proxy_settings.model or "unknown"
        )
        payload = _serialize_completion(result, configured_model)
    except Exception as exc:
        logger.warning(
            "AI chat serialize failed request_id=%s user_id=%s error_type=%s error=%s",
            request_id,
            user_id,
            type(exc).__name__,
            _exc_text(exc),
        )
        return _error_response(
            502,
            message="AI 服务暂时不可用",
            error_type="upstream_error",
            code="ai_upstream_error",
            request_id=request_id,
        )

    choice = payload.choices[0]
    tool_count = 0 if not choice.message.tool_calls else len(choice.message.tool_calls)
    logger.info(
        "AI chat completed request_id=%s user_id=%s model=%s finish_reason=%s "
        "tool_calls=%s latency_ms=%s",
        request_id,
        user_id,
        payload.model,
        choice.finish_reason,
        tool_count,
        int((time.monotonic() - started) * 1000),
    )
    if choice.finish_reason == "length":
        logger.warning(
            "AI chat truncated request_id=%s user_id=%s", request_id, user_id
        )
    return _completion_response(payload, request_id)
