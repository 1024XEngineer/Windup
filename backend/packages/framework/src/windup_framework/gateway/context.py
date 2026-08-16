from __future__ import annotations

from contextvars import ContextVar, Token
from dataclasses import dataclass
from typing import Callable


@dataclass(frozen=True)
class CallContext:
    request_id: str | None = None
    task_id: str | None = None
    user_id: str | None = None
    start_from_model: str | None = None


_call_context: ContextVar[CallContext] = ContextVar("windup_gateway_call_context", default=CallContext())


def current_call_context() -> CallContext:
    return _call_context.get()


def bind_call_context(
    *,
    request_id: str | None = None,
    task_id: str | None = None,
    user_id: str | None = None,
    start_from_model: str | None = None,
) -> Callable[[], None]:
    token: Token[CallContext] = _call_context.set(
        CallContext(
            request_id=request_id,
            task_id=task_id,
            user_id=user_id,
            start_from_model=start_from_model,
        )
    )

    def reset() -> None:
        _call_context.reset(token)

    return reset
