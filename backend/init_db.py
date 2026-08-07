#!/usr/bin/env python3
"""初始化数据库并启动后端服务。

使用 SQLite 作为开发数据库，避免依赖 PostgreSQL。
"""

import os

from windup_framework.config.database import resolve_sqlite_path

# 所有入口共用 framework 层的解析规则，避免从不同目录启动时创建同名空库。
os.environ["SQLITE_PATH"] = str(resolve_sqlite_path(os.getenv("SQLITE_PATH", "windup.db")))

def init_database():
    """初始化数据库，创建所有表。"""
    from windup_framework.db.base import Base
    from windup_framework.db.session import engine

    # 注册所有 ORM 模型后，Base.metadata 才包含完整表结构。
    from windup_app.server.character.model import Character  # noqa: F401
    from windup_app.server.generation.model import GenerationTaskRecord  # noqa: F401
    from windup_app.server.playtest_inspection.model import PlaytestInspection  # noqa: F401
    from windup_app.server.project.model import Project  # noqa: F401

    print("正在初始化数据库...")
    Base.metadata.create_all(engine)
    print("数据库初始化完成！")


def main():
    """主函数：初始化数据库并启动后端服务。"""
    # 初始化数据库
    init_database()

    # 启动后端服务
    print("正在启动后端服务...")
    from windup_app.bootstrap.app import main as start_server

    start_server()


if __name__ == "__main__":
    main()
