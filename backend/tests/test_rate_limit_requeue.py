"""限流被拒的任务应当重投,不是判失败。

实测(2026-08-27,近三天):143 个动作任务里 50 个失败,其中 40 个的失败原因是通用的
"生成没能完成",而网关记账显示同期 252 次失败里 225 次是 429 且 ``maybe_billed=False``
—— 上游根本没建单、没扣配额。这些任务是被"20 秒内放弃"判死的,不是真的做不出来。
"""
from __future__ import annotations

import pytest

from windup_app.server.orchestrator.signals import ActionRateLimited
from windup_common.enums.model import ModelErrorType
from windup_framework.gateway.errors import UpstreamExhaustedError


def test_rate_limited_without_a_job_is_free_to_retry():
    """拦的坏例:把"被限流"和"可能已计费"当成一回事。

    前者重投是免费的,后者重投就是再花一次钱。判错的方向不同、代价不对称,
    所以判据挂在异常上,而不是留给每个调用方自己 in 匹配文案。
    """
    e = UpstreamExhaustedError("x", error_type=ModelErrorType.RATE_LIMIT, maybe_billed=False)
    assert e.is_free_retryable is True


def test_rate_limited_after_binding_a_job_is_not_free():
    """已经绑过单就可能已计费 —— 重投等于再花一次钱,只能判失败。"""
    e = UpstreamExhaustedError("x", error_type=ModelErrorType.RATE_LIMIT, maybe_billed=True)
    assert e.is_free_retryable is False


@pytest.mark.parametrize("kind", [ModelErrorType.UNREACHED, ModelErrorType.UPSTREAM_FAILED,
                                  ModelErrorType.AUTH, None])
def test_only_rate_limit_gets_the_free_retry_path(kind):
    """拦的坏例:把所有失败都当成可重投。

    鉴权错、上游真失败这些重投多少次都一样,而每次重投都要再跑一遍抠图与上传。
    """
    assert UpstreamExhaustedError("x", error_type=kind).is_free_retryable is False


def test_the_typed_exception_stays_a_runtime_error():
    """既有的 ``except RuntimeError`` / ``except Exception`` 一个都不该改。

    换异常类型时最容易漏的就是这条:某个上层只 catch RuntimeError,换成裸 Exception
    子类之后那里就漏网,而漏网的表现是任务卡在 RUNNING 不是报错。
    """
    assert issubclass(UpstreamExhaustedError, RuntimeError)


def test_the_signal_module_pulls_in_nothing():
    """信号模块必须零依赖。

    它要被 ``worker.handlers`` import,而 ``executor`` 依赖 ai_engine ——
    从 executor 里 import 会让入口层经由 handlers 间接连上 ai_engine,
    分层契约"入口层不经 ai_engine 直连"就是拦这个的(本用例写下时刚踩过一次)。
    """
    import ast
    import pathlib

    src = pathlib.Path(
        "packages/app/src/windup_app/server/orchestrator/signals.py"
    ).read_text()
    imported = [
        n.module or ""
        for n in ast.walk(ast.parse(src))
        if isinstance(n, ast.ImportFrom)
    ]
    assert all(m == "__future__" for m in imported), f"信号模块引入了依赖: {imported}"
    assert issubclass(ActionRateLimited, Exception)
