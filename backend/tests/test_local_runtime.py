"""本地启动入口的路径与 Windows 事件循环回归测试。"""

from __future__ import annotations

import asyncio
import os
import subprocess
import sys
from pathlib import Path

import pytest
import uvicorn

from windup_app.bootstrap import app as app_module


BACKEND_ROOT = Path(__file__).resolve().parents[1]


def test_init_db_resolves_relative_sqlite_path_from_backend_directory(tmp_path):
    """无论从哪个目录启动，都必须复用 backend/windup.db，而不是创建新空库。"""
    script = """
import importlib.util
import os
from pathlib import Path

path = Path(os.environ["WINDUP_INIT_DB"])
spec = importlib.util.spec_from_file_location("windup_init_db", path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
print(os.environ["SQLITE_PATH"])
"""
    env = os.environ.copy()
    env["SQLITE_PATH"] = "./windup.db"
    env["WINDUP_INIT_DB"] = str(BACKEND_ROOT / "init_db.py")

    completed = subprocess.run(
        [sys.executable, "-c", script],
        cwd=tmp_path,
        env=env,
        check=True,
        capture_output=True,
        text=True,
    )

    assert Path(completed.stdout.strip()) == (BACKEND_ROOT / "windup.db").resolve()


def test_framework_resolves_relative_sqlite_path_from_backend_directory(tmp_path):
    """直接运行 windup 入口时也必须使用同一份本地库。"""
    script = """
from windup_framework.db.session import engine
print(engine.url.database)
"""
    env = os.environ.copy()
    env["SQLITE_PATH"] = "./windup.db"

    completed = subprocess.run(
        [sys.executable, "-c", script],
        cwd=tmp_path,
        env=env,
        check=True,
        capture_output=True,
        text=True,
    )

    assert Path(completed.stdout.strip()) == (BACKEND_ROOT / "windup.db").resolve()


@pytest.mark.skipif(sys.platform != "win32", reason="仅验证 Windows asyncio 运行时")
def test_main_passes_selector_loop_factory_to_uvicorn(monkeypatch):
    """Uvicorn 必须实际创建 Selector，而不是覆盖一个只写在全局 policy 的配置。"""
    captured_options = {}

    def capture_run(*args, **kwargs):
        captured_options.update(kwargs)

    monkeypatch.setattr(uvicorn, "run", capture_run)
    app_module.main()

    loop_factory = captured_options["loop"]
    loop = loop_factory()
    try:
        assert isinstance(loop, asyncio.SelectorEventLoop)
    finally:
        loop.close()
