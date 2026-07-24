"""七牛 Kodo 存储配置的单元测试(不连网)。

用 ``_env_file=None`` + ``monkeypatch`` 隔离 ``.env``,确保断言不依赖本地真实密钥。
"""

import os

from windup_framework.config.storage import StorageSettings, settings


def _clear_qiniu_env(monkeypatch) -> None:
    """清掉所有 QINIU_ 环境变量,避免本机 .env 污染断言。"""
    for key in list(os.environ):
        if key.startswith("QINIU_"):
            monkeypatch.delenv(key, raising=False)


def test_settings_loads():
    """StorageSettings 能加载,字段类型正确。"""
    s = StorageSettings()
    assert isinstance(s.access_key, str)
    assert isinstance(s.secret_key, str)
    assert isinstance(s.bucket_name, str)
    assert isinstance(s.bucket_domain, str)
    assert isinstance(s.private_space, bool)
    assert isinstance(s.upload_expires, int)
    assert isinstance(s.download_expires, int)


def test_defaults(monkeypatch):
    """默认值:private_space=False、expires=3600、region=None、密钥为空串。"""
    _clear_qiniu_env(monkeypatch)
    s = StorageSettings(_env_file=None)
    assert s.private_space is False
    assert s.upload_expires == 3600
    assert s.download_expires == 3600
    assert s.region is None
    assert s.access_key == ""
    assert s.secret_key == ""


def test_download_base_strips_trailing_slash(monkeypatch):
    """download_base 去掉末尾 /,无 / 时不变。"""
    _clear_qiniu_env(monkeypatch)
    s = StorageSettings(_env_file=None, bucket_domain="https://cdn.example.com/")
    assert s.download_base == "https://cdn.example.com"
    s2 = StorageSettings(_env_file=None, bucket_domain="https://cdn.example.com")
    assert s2.download_base == "https://cdn.example.com"


def test_env_prefix_qiniu(monkeypatch):
    """QINIU_ 前缀绑定生效,env 值覆盖默认。"""
    _clear_qiniu_env(monkeypatch)
    monkeypatch.setenv("QINIU_ACCESS_KEY", "ak-test")
    monkeypatch.setenv("QINIU_SECRET_KEY", "sk-test")
    monkeypatch.setenv("QINIU_BUCKET_NAME", "test-bucket")
    monkeypatch.setenv("QINIU_BUCKET_DOMAIN", "https://cdn.test.com")
    monkeypatch.setenv("QINIU_PRIVATE_SPACE", "true")
    monkeypatch.setenv("QINIU_REGION", "z0")
    s = StorageSettings(_env_file=None)
    assert s.access_key == "ak-test"
    assert s.secret_key == "sk-test"
    assert s.bucket_name == "test-bucket"
    assert s.download_base == "https://cdn.test.com"
    assert s.private_space is True
    assert s.region == "z0"


def test_module_singleton_created():
    """模块级单例 settings 可用(不连网)。"""
    assert settings is not None
    assert isinstance(settings, StorageSettings)
