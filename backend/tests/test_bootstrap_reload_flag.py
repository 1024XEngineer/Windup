"""WINDUP_RELOAD 解析测试:确保 false/0/no/'' 关闭 reload。"""

import pytest

from windup_app.bootstrap.app import _env_flag


@pytest.mark.parametrize(
    "value,expected",
    [
        ("1", True),
        ("true", True),
        ("TRUE", True),
        ("yes", True),
        ("on", True),
        ("  true  ", True),
        ("0", False),
        ("false", False),
        ("no", False),
        ("off", False),
        ("", False),
    ],
)
def test_env_flag_parses_truthiness(monkeypatch, value, expected):
    monkeypatch.setenv("WINDUP_RELOAD", value)
    assert _env_flag("WINDUP_RELOAD") is expected


def test_env_flag_unset_is_false(monkeypatch):
    monkeypatch.delenv("WINDUP_RELOAD", raising=False)
    assert _env_flag("WINDUP_RELOAD") is False
