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

# 非 pydantic-settings 消费的键:由 docker-compose / 部署脚本直接读,或 mq/sse 模块 os.getenv。
_INFRA_KEYS = frozenset({
    "WINDUP_HOST", "WINDUP_PORT", "WINDUP_CORS_ORIGINS", "WINDUP_CORS_ORIGIN_REGEX",
    "POSTGRES_DATA_DIR", "REDIS_DATA_DIR", "POSTGRES_EXTERNAL_PORT",
    "SERPAPI_API_KEY", "VITE_API_BASE_URL",
    # windup_framework.mq.config / windup_app.server.mq.catalog / sse.bridge
    "WINDUP_MQ_STREAM_MAXLEN", "WINDUP_MQ_PEL_CLAIM_IDLE_MS",
    "WINDUP_MQ_PEL_CLAIM_INTERVAL_SECONDS", "WINDUP_MQ_MAX_PUBLISH_ATTEMPTS",
    "WINDUP_MQ_MAX_CONSUME_ATTEMPTS", "WINDUP_MQ_CONSUME_LEASE_SECONDS",
    "WINDUP_MQ_EMAIL_HANDLER_RETRIES", "WINDUP_MQ_EMAIL_CONCURRENCY",
    "WINDUP_MQ_GENERATION_IMAGE_CONCURRENCY", "WINDUP_MQ_GENERATION_ACTION_CONCURRENCY",
    "WINDUP_MQ_GENERATION_POLL_CONCURRENCY",
    "WINDUP_I2V_INFLIGHT_MAX",
    "WINDUP_MQ_DELAYED_ZSET", "WINDUP_MQ_DELAYED_CLAIM_LIMIT",
    "WINDUP_MQ_DELAYED_TICK_SECONDS",
    "WINDUP_IO_POOL_SIZE",
    "WINDUP_GENERATION_PENDING_MAX_AGE", "WINDUP_GENERATION_RUNNING_STALE_SECONDS",
    "WINDUP_SSE_REDIS_CHANNEL",
    # windup_framework.providers.matte._refine_enabled:os.environ,不走 BaseSettings
    "WINDUP_MATTE_REFINE",
    # providers.matte_factory.make_matte_provider:同上,os.environ。
    # 走 BaseSettings 的话 framework 的配置层就要认识 provider 的名字,而选哪个 provider
    # 是装配决定,不是配置数据。
    "WINDUP_MATTE_PROVIDER",
    # render3d._tc3.TencentCredentials.resolve:环境变量 → 加锁文件,不走 BaseSettings
    "TENCENT_SECRET_ID", "TENCENT_SECRET_KEY", "TENCENT_REGION",
    # orchestrator.client_bake / docker-compose 的构建目标,都是 os.getenv
    "WINDUP_RENDER3D_CLIENT_BAKE", "WINDUP_RENDER3D_CLIENT_BAKE_DEADLINE_S",
    "WINDUP_WORKER_TARGET",
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


# ── 值也要对，不只是键存在 ────────────────────────────────────────────────


def _example_pairs() -> dict[str, str]:
    if not _ENV_EXAMPLE.is_file():
        pytest.skip(f"没有 {_ENV_EXAMPLE}")
    out: dict[str, str] = {}
    for line in _ENV_EXAMPLE.read_text(encoding="utf-8").splitlines():
        if m := re.match(r"^([A-Z][A-Z0-9_]*)=(.*)$", line.strip()):
            out[m.group(1)] = m.group(2)
    return out


#: 声称"取值即默认值"的那几个键。只列这几个而不是全表:大部分键是**站位值**
#: (``AI_API_KEY=your-ai-api-key``),它们本来就不该等于默认值。
_PINNED_TO_DEFAULT = {
    "AI_CHAT_FALLBACKS": ("provider", "chat_fallbacks"),
    "AI_IMAGE_MODEL": ("provider", "image_model"),
    "AI_VIDEO_MODEL": ("provider", "video_model"),
    "AI_IMAGE_FALLBACKS": ("provider", "image_fallbacks"),
    "AI_VIDEO_FALLBACKS": ("provider", "video_fallbacks"),
    "AI_VIDEO_VEO_USER_IDS": ("provider", "video_veo_user_ids"),
}


@pytest.mark.parametrize("key", sorted(_PINNED_TO_DEFAULT))
def test_env_example_matches_code_defaults(key):
    """拦的坏例:模板里的型号和代码默认值各走各的。

    实测的漂移(2026-08-27):模板写 ``AI_VIDEO_MODEL=kling-v2-5-turbo``、代码默认是
    ``kling-v3-turbo-std``、生产 .env 里是 ``agnes-video-2.5-flash`` —— 同一个配置项
    三个地方三个值。照模板部署的人拿到的既不是他以为的那个,也不是生产在跑的那个,
    而且不会有任何一道报错:型号是合法的,只是不是你想要的那个。

    只钉那几行明说了"取值即默认值"的;站位值(API key 一类)不在此列。
    """
    import importlib

    mod_name, field = _PINNED_TO_DEFAULT[key]
    mod = importlib.import_module(f"windup_framework.config.{mod_name}")
    cls = type(mod.settings)
    default = cls.model_fields[field].default
    assert _example_pairs()[key] == str(default), (
        f".env.example 的 {key} 是 {_example_pairs()[key]!r},"
        f"而代码默认值是 {default!r} —— 改了默认值就要同步模板"
    )
