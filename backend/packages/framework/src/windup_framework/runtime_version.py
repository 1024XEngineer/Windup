"""这次生成跑在哪个版本上 —— 供任务落库时记账。

**为什么不复用 ``PROMPT_VERSION``**:那是个手工维护的常量,注释写明"改提示词必须
连带加一",但它自引入起从未变过,期间 #320 改过攻击提示词、#416 改过动作预设文案,
两次都没加。靠人记得改的版本号必然漂移,记录不了真实版本。

所以这里只取**不需要人维护**的来源:构建期烘进镜像的 commit,取不到时退回运行期
探测 git,再取不到才是 unknown。三层都记明来源,让读账的人知道这个值可不可信。
"""
from __future__ import annotations

import functools
import os
import subprocess
from pathlib import Path


def _from_env() -> tuple[str, str] | None:
    """构建期注入。生产走这条 —— 镜像里没有 .git。"""
    sha = (os.getenv("WINDUP_BUILD_COMMIT") or "").strip()
    return (sha[:12], "build") if sha else None


def _from_git() -> tuple[str, str] | None:
    """开发机走这条。子进程只在首次调用时起一次(见 lru_cache)。"""
    try:
        out = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=Path(__file__).resolve().parent, capture_output=True, text=True, timeout=3,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    sha = out.stdout.strip()
    return (sha[:12], "git") if out.returncode == 0 and sha else None


@functools.lru_cache(maxsize=1)
def code_version() -> dict[str, str]:
    """``{"commit": ..., "source": build|git|unknown}``。进程内只算一次。"""
    for probe in (_from_env, _from_git):
        got = probe()
        if got:
            return {"commit": got[0], "source": got[1]}
    return {"commit": "unknown", "source": "unknown"}


def runtime_snapshot(**extra: str | None) -> dict:
    """任务落库时记的那一份。``extra`` 收生成侧真正用到的型号等。

    只收调用方**实际用到**的值,不收配置里的默认值 —— 配置改了而任务跑在旧进程上时,
    记下配置等于记了一个没发生过的事实。
    """
    snap = dict(code_version())
    snap.update({k: v for k, v in extra.items() if v})
    return snap
