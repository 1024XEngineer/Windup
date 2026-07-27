"""``python -m windup_app`` 入口测试:__main__ 委托到 bootstrap.app:main。"""

import importlib.util


def test_dash_m_entrypoint_exists():
    """windup_app.__main__ 模块可被 -m 解析。"""
    assert importlib.util.find_spec("windup_app.__main__") is not None


def test_dash_m_delegates_to_main():
    """__main__ 委托的是同一个 bootstrap.app:main(与 windup 脚本一致,不重复逻辑)。"""
    import windup_app.__main__ as entry
    from windup_app.bootstrap.app import main

    assert entry.main is main
