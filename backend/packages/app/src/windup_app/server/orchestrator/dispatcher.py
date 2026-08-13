"""进程内生成任务调度器。"""

from collections.abc import Callable
from concurrent.futures import Future, ThreadPoolExecutor
from typing import Any


class GenerationDispatcher:
    """串行执行付费生成任务，避免并发触发上游限流。"""

    def __init__(self) -> None:
        self._executor = ThreadPoolExecutor(
            max_workers=1,
            thread_name_prefix="windup-generation",
        )

    def submit(self, target: Callable[..., Any], *args: Any) -> Future[Any]:
        return self._executor.submit(target, *args)

    def shutdown(self) -> None:
        self._executor.shutdown(wait=True)
