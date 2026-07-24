"""数据库配置与 engine 的单元测试(不连真实库)。"""

from sqlalchemy.orm import DeclarativeBase

from windup_framework.config.database import DatabaseSettings, settings
from windup_framework.db import Base, SessionLocal, engine


def test_settings_loads_with_valid_url():
    """DatabaseSettings 能加载,url 形如 postgresql+psycopg://..."""
    s = DatabaseSettings()
    assert s.url.startswith("postgresql+psycopg://")
    assert s.host
    assert isinstance(s.port, int)


def test_url_contains_connection_info():
    """url 含 host/port/db。"""
    url = settings.url
    assert settings.host in url
    assert settings.db in url
    assert str(settings.port) in url


def test_engine_and_session_factory_created():
    """engine 与 SessionLocal 可创建(不连库)。"""
    assert engine is not None
    assert SessionLocal is not None


def test_base_is_declarative():
    """Base 是 DeclarativeBase 子类,可被领域模型继承。"""
    assert issubclass(Base, DeclarativeBase)
