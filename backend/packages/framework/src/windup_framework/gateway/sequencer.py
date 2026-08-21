from __future__ import annotations


class AttemptSequencer:
    """Monotonic attempt_index within one gateway request_id."""

    def __init__(self) -> None:
        self._next = 0

    def next_index(self) -> int:
        value = self._next
        self._next += 1
        return value
