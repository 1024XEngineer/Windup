"""生成链路的 IO 与短 session:共享线程池、并行上传、连接尽快归还。

执行器只协调阶段结果;本模块持有进程级 IO 池。必须从 handler 线程往里
submit,禁止在池内任务再 ``io_map``(同池会死锁)。

失败语义与串行相同:已成功的 PUT 会留在桶里(孤儿),任务仍 FAILED。
"""

from __future__ import annotations

import contextvars
import os
import threading
from collections.abc import Callable, Sequence
from concurrent.futures import Future, ThreadPoolExecutor
from typing import TypeVar

from sqlalchemy.orm import Session

T = TypeVar("T")
R = TypeVar("R")


def _env_int(name: str, default: int) -> int:
    raw = os.getenv(name, "").strip()
    return int(raw) if raw else default


_IO_POOL_SIZE = max(1, _env_int("WINDUP_IO_POOL_SIZE", 32))
_io_pool_lock = threading.Lock()
_io_pool: ThreadPoolExecutor | None = None


def _shared_io_pool() -> ThreadPoolExecutor:
    global _io_pool
    if _io_pool is None:
        with _io_pool_lock:
            if _io_pool is None:
                _io_pool = ThreadPoolExecutor(
                    max_workers=_IO_POOL_SIZE,
                    thread_name_prefix="windup-io",
                )
    return _io_pool


def submit_io(fn: Callable[[T], R], items: Sequence[T]) -> list[Future[R]]:
    """把独立 IO 丢进共享池。每个任务一份 Context 快照——同一 Context 不能被两线程同时 enter。"""
    pool = _shared_io_pool()
    futs: list[Future[R]] = []
    for item in items:
        ctx = contextvars.copy_context()
        futs.append(pool.submit(ctx.run, fn, item))
    return futs


def io_map(fn: Callable[[T], R], items: Sequence[T]) -> list[R]:
    if not items:
        return []
    if len(items) == 1:
        return [fn(items[0])]
    return [fut.result() for fut in submit_io(fn, items)]


def upload_frames(upload: Callable[[bytes], str], pngs: Sequence[bytes]) -> list[str]:
    """并行上传各帧,返回 URL 列表,下标与 ``pngs`` 对齐。"""
    return io_map(upload, pngs)


def using_session(
    session: Session | None,
    factory: Callable[[], Session],
    fn: Callable[[Session], T],
) -> T:
    """自开的 session 只包住 fn:commit 后立刻 close,生成/上传期间不占连接池。

    调用方传入的 session 不提交、不关闭(测试事务)。
    """
    if session is not None:
        return fn(session)
    owned = factory()
    try:
        out = fn(owned)
        owned.commit()
        return out
    except Exception:
        owned.rollback()
        raise
    finally:
        owned.close()
