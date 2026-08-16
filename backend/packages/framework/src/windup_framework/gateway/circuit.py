from __future__ import annotations

import time
from collections.abc import Callable


class CircuitBreaker:
    def __init__(
        self,
        *,
        cooldown_s: float = 60,
        monotonic: Callable[[], float] | None = None,
    ) -> None:
        self._cooldown_s = cooldown_s
        self._monotonic = monotonic or time.monotonic
        self._open_until: dict[str, float] = {}

    def is_open(self, key: str) -> bool:
        until = self._open_until.get(key)
        if until is None:
            return False
        if self._monotonic() >= until:
            del self._open_until[key]
            return False
        return True

    def open(self, key: str) -> None:
        self._open_until[key] = self._monotonic() + self._cooldown_s
