"""ORM 模型基类。

所有领域模型(定义在 ``app/server`` 各领域)继承 ``Base``,
通过 ``Base.metadata`` 统一管理表结构。
"""

from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    """所有 ORM 模型的基类。"""
