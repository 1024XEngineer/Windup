"""`.env.example` 里的键必须真的被读到。

填了、不报错、也不生效的配置键是本仓反复清理的那一类问题(``ActionSpec.fps`` /
``CharacterCard.palette``)。区别在于配置模板错了会**每个新部署重犯一次**,而且只有
去问运行中的进程才发现 —— 照模板填 ``LLM_IMAGE_MODEL_ID=gemini-3.0-pro-image-preview``
的部署,实际跑的是 ``AIProviderSettings.image_model`` 的默认值。Refs 1024XEngineer/Windup#288。
"""
from __future__ import annotations

import pathlib
import re

import pytest

_ENV_EXAMPLE = pathlib.Path(__file__).resolve().parents[2] / ".env.example"

# 非 pydantic-settings 消费的键:由 docker-compose / 部署脚本直接读,不走配置类。
_INFRA_KEYS = frozenset({
    "WINDUP_HOST", "WINDUP_PORT", "WINDUP_CORS_ORIGINS", "WINDUP_CORS_ORIGIN_REGEX",
    "POSTGRES_DATA_DIR", "REDIS_DATA_DIR", "POSTGRES_EXTERNAL_PORT",
    "SERPAPI_API_KEY", "VITE_API_BASE_URL",
})


def _example_keys() -> set[str]:
    if not _ENV_EXAMPLE.is_file():
        pytest.skip(f"没有 {_ENV_EXAMPLE}")
    return {
        m.group(1)
        for line in _ENV_EXAMPLE.read_text(encoding="utf-8").splitlines()
        if (m := re.match(r"^([A-Z][A-Z0-9_]*)=", line.strip()))
    }


def _settings_classes():
    """遍历 config 包的每个子模块 —— 包的 __init__ 未必把配置类都再导出一遍。"""
    import importlib
    import pkgutil

    from pydantic_settings import BaseSettings

    import windup_framework.config as cfg

    out = []
    for mod in pkgutil.iter_modules(cfg.__path__):
        m = importlib.import_module(f"{cfg.__name__}.{mod.name}")
        for name in dir(m):
            obj = getattr(m, name)
            if (isinstance(obj, type) and issubclass(obj, BaseSettings)
                    and obj is not BaseSettings and obj not in out):
                out.append(obj)
    return out


def _live_keys() -> set[str]:
    """所有配置类按各自 env_prefix 展开出来的、真正会被读的环境变量名。"""
    keys = set()
    for cls in _settings_classes():
        prefix = cls.model_config.get("env_prefix", "")
        keys |= {f"{prefix}{f}".upper() for f in cls.model_fields}
    return keys


def test_settings_classes_are_discoverable():
    """先验仪器:一个配置类都没找到的话,下面那条会空跑成绿的。"""
    assert len(_settings_classes()) >= 5


def test_every_example_key_is_actually_read():
    live = _live_keys()
    dead = sorted(k for k in _example_keys() if k not in live and k not in _INFRA_KEYS)
    assert not dead, (
        f"这些键在 .env.example 里,但没有任何配置类会读:{dead}。"
        "填了不生效比不填更糟——部署方以为配置生效了。"
        "确认前缀与对应 BaseSettings 的 env_prefix 一致。"
    )
