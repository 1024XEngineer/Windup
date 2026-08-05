"""数据库 engine 与 session 工厂。

- ``engine``: 全局单例,模块级 import 时创建(不连库,lazy)
- ``SessionLocal``: session 工厂
- ``get_session``: FastAPI 依赖,每请求一个 session
"""

import os
from collections.abc import Iterator

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from windup_framework.config.database import settings as db_settings

sqlite_path = os.getenv("SQLITE_PATH")
if sqlite_path:
    engine = create_engine(
        f"sqlite:///{sqlite_path}",
        connect_args={"check_same_thread": False},
    )
else:
    engine = create_engine(
        db_settings.url,
        pool_size=db_settings.pool_size,
        max_overflow=db_settings.max_overflow,
        pool_pre_ping=db_settings.pool_pre_ping,
    )

SessionLocal = sessionmaker(bind=engine, expire_on_commit=False)


def get_session() -> Iterator[Session]:
    """FastAPI 依赖:每请求一个同步 session,请求结束自动关闭。"""
    with SessionLocal() as session:
        try:
            yield session
            session.commit()
        except Exception:
            session.rollback()
            raise
        finally:
            session.close()
