from __future__ import annotations

import threading
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
        self._lock = threading.Lock()

    def is_open(self, key: str) -> bool:
        with self._lock:
            until = self._open_until.get(key)
            if until is None:
                return False
            if self._monotonic() >= until:
                self._open_until.pop(key, None)
                return False
            return True

    def open(self, key: str) -> None:
        with self._lock:
            self._open_until[key] = self._monotonic() + self._cooldown_s
