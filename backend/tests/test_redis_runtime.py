"""Redis 本地开发配置与启动入口。"""

from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]


def test_redis_settings_default_and_environment_override(monkeypatch):
    from windup_framework.config.redis import RedisSettings

    monkeypatch.delenv("REDIS_ENABLED", raising=False)
    monkeypatch.delenv("REDIS_URL", raising=False)
    assert RedisSettings().enabled is False
    assert RedisSettings().url == "redis://127.0.0.1:6379/0"

    monkeypatch.setenv("REDIS_ENABLED", "true")
    monkeypatch.setenv("REDIS_URL", "redis://127.0.0.1:6380/2")
    overridden = RedisSettings()
    assert overridden.enabled is True
    assert overridden.url == "redis://127.0.0.1:6380/2"


def test_disabled_redis_does_not_create_a_client():
    from windup_framework.config.redis import RedisSettings
    from windup_framework.db.redis import create_redis_client

    assert create_redis_client(RedisSettings(enabled=False)) is None


def test_installer_sets_library_path_before_reusing_existing_runtime():
    installer = (
        REPO_ROOT / "backend" / "scripts" / "install-redis-wsl.sh"
    ).read_text(encoding="utf-8")

    assert installer.index("export LD_LIBRARY_PATH") < installer.index(
        'if [[ -x "$redis_server"'
    )
