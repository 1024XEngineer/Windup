"""比对 ORM 模型与库里的实际表结构，补出缺的列。

`Base.metadata.create_all` 只补缺失的**表**，不给已有表加列。于是给已上线的表加一个字段时，
生产库不会自己长出那一列，而 ORM 查询会显式点名它 —— 整个应用起不来。本仓至今没有迁移机制，
部署后也从没给已有表加过列，所以这条路一直是未验证的。

**只做加法。** 改类型、删列、加非空且无默认值的列一律拒绝并列出来，交给人写 SQL：
前两者会丢数据，后者在有存量行的表上直接失败。加法是唯一能在不知道数据长什么样时安全自动化的。
"""
from __future__ import annotations

import argparse
import os
import sys

os.environ.setdefault("JWT_SECRET", "schema-sync-only-secret-32-characters")
os.environ.setdefault("POSTGRES_PASSWORD", "schema-sync-only-password")

from sqlalchemy import inspect, text  # noqa: E402
from sqlalchemy.engine import Engine  # noqa: E402
from sqlalchemy.schema import CreateColumn  # noqa: E402

from windup_framework.db import Base, engine as default_engine  # noqa: E402


def _norm_type(compiled: str) -> str:
    """方言编译出的类型串归一,只吃掉排版差异,不吃掉参数。"""
    return "".join(compiled.split()).upper()


def _load_models() -> None:
    """导入所有 ORM 模块，让 Base.metadata 认全。

    与 bootstrap 用同一份清单会更好，但那个模块会连带起 FastAPI 应用；本脚本要能在
    没有应用上下文的部署机上跑。
    """
    import windup_app.server.character.model  # noqa: F401
    import windup_app.server.project.model  # noqa: F401
    import windup_app.server.quota.model  # noqa: F401
    import windup_app.server.user.model  # noqa: F401
    import windup_framework.gateway.models  # noqa: F401

    try:  # 有的模块随功能演进增删，缺了不该让整个巡检停摆
        import windup_app.server.orchestrator.model  # noqa: F401
        import windup_app.server.workflow.model  # noqa: F401
    except ImportError:
        pass


def plan(engine: Engine, metadata=None) -> tuple[list[tuple[str, str, str]], list[str]]:
    """返回 (可自动补的列, 需要人处理的项)。

    ``metadata`` 只为测试留:默认走全仓模型,传入时可以在隔离的库上验本函数自己。
    """
    if metadata is None:
        _load_models()
        metadata = Base.metadata
    insp = inspect(engine)
    live_tables = set(insp.get_table_names())
    additive: list[tuple[str, str, str]] = []
    manual: list[str] = []

    for table in metadata.sorted_tables:
        if table.name not in live_tables:
            continue                      # 缺整张表 → create_all 会建，不归本脚本
        live = {c["name"]: c for c in insp.get_columns(table.name)}
        for col in table.columns:
            if col.name in live:
                # 按方言编译而不是 str(col.type):BigInteger().with_variant(Integer, "sqlite")
                # 这类声明的 str() 恒是基类型,拿它比会在变体生效的库上误报类型不一致。
                want = col.type.compile(engine.dialect)
                got = live[col.name]["type"].compile(engine.dialect)
                # 连参数一起比:只比基类型的话 VARCHAR(20) 与 VARCHAR(200)、
                # NUMERIC 的不同精度都会被当成一样,而它们正是会丢数据的那类改动。
                if _norm_type(want) != _norm_type(got):
                    manual.append(
                        f"{table.name}.{col.name} 类型不一致：模型 {want} / 库 {got}"
                    )
                continue
            if not col.nullable and col.server_default is None:
                manual.append(
                    f"{table.name}.{col.name} 是非空且无 server_default，"
                    "存量行填不出值，请人工决定默认值后再加"
                )
                continue
            ddl = str(CreateColumn(col).compile(engine))
            additive.append((table.name, col.name, ddl))

        # 反向:库里有、模型没有。删列会丢数据,本脚本只报不动 —— 不报的话
        # 巡检会在"模型删了一列"时返回干净,而库里那一列还带着数据。
        for name in live.keys() - {c.name for c in table.columns}:
            manual.append(
                f"{table.name}.{name} 库里有而模型没有：删列会丢数据，请人工确认后手写 SQL"
            )
    return additive, manual


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--apply", action="store_true",
                    help="真的执行；缺省只报告，退出码非 0 表示有漂移")
    a = ap.parse_args()

    additive, manual = plan(default_engine)
    for m in manual:
        print(f"[需人工] {m}")
    for tbl, col, ddl in additive:
        print(f"[可自动] ALTER TABLE {tbl} ADD COLUMN {ddl};")

    if manual:
        print(f"\n{len(manual)} 项需要人工处理，本脚本不动它们。")
    if not additive:
        print("没有可自动补的列。")
        return 1 if manual else 0

    if not a.apply:
        print(f"\n{len(additive)} 列待补。加 --apply 执行。")
        return 1

    with default_engine.begin() as conn:
        for tbl, col, ddl in additive:
            conn.execute(text(f"ALTER TABLE {tbl} ADD COLUMN {ddl}"))
            print(f"已补 {tbl}.{col}")
    return 1 if manual else 0


if __name__ == "__main__":
    sys.exit(main())
