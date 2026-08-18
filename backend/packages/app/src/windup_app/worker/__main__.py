"""Worker 进程入口：``python -m windup_app.worker``。

实际装配在 ``windup_app.bootstrap.worker``，避免 worker 包静态依赖 executor/ai_engine。
"""

from __future__ import annotations

import runpy

if __name__ == "__main__":
    runpy.run_module("windup_app.bootstrap.worker", run_name="__main__")
