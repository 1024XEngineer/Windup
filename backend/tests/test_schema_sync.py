"""schema_sync 的行为：只补加法，其余交给人。"""
from __future__ import annotations

import pathlib
import sys

import pytest
from sqlalchemy import Boolean, Column, Integer, MetaData, String, Table, create_engine, inspect, text

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "scripts"))
from schema_sync import plan  # noqa: E402


def _engine_with(table: Table):
    """建一个只有这张表的临时库。"""
    eng = create_engine("sqlite://")
    md = MetaData()
    Table(table.name, md, *[c._copy() for c in table.columns])
    md.create_all(eng)
    return eng


def _model(*cols) -> Table:
    return Table("proj", MetaData(), Column("id", Integer, primary_key=True), *cols)


def test_a_new_nullable_column_is_planned_as_additive():
    """给已上线的表加一个可空列 —— 这正是本脚本存在的理由。"""
    live = _model()
    want = _model(Column("is_pixel_art", Boolean, nullable=True))
    additive, manual = plan(_engine_with(live), want.metadata)

    assert manual == []
    assert [(t, c) for t, c, _ in additive] == [("proj", "is_pixel_art")]


def test_applying_the_plan_makes_the_column_real():
    """报出来还不够，执行完库里要真的有这一列。"""
    live = _model()
    want = _model(Column("is_pixel_art", Boolean, nullable=True))
    eng = _engine_with(live)
    additive, _ = plan(eng, want.metadata)

    with eng.begin() as conn:
        for tbl, _col, ddl in additive:
            conn.execute(text(f"ALTER TABLE {tbl} ADD COLUMN {ddl}"))

    assert "is_pixel_art" in {c["name"] for c in inspect(eng).get_columns("proj")}
    assert plan(eng, want.metadata) == ([], []), "补完再跑应当无事可做（幂等）"


def test_a_not_null_column_without_default_is_left_to_a_human():
    """存量行填不出值，自动加只会当场失败 —— 报出来而不是硬上。"""
    live = _model()
    want = _model(Column("owner", String(20), nullable=False))
    additive, manual = plan(_engine_with(live), want.metadata)

    assert additive == []
    assert len(manual) == 1 and "owner" in manual[0]


def test_a_type_change_is_never_applied_silently():
    """改类型会丢数据，只报不动。"""
    live = _model(Column("sprite_width", Integer))
    want = _model(Column("sprite_width", String(20)))
    additive, manual = plan(_engine_with(live), want.metadata)

    assert additive == []
    assert len(manual) == 1 and "类型不一致" in manual[0]


def test_a_table_that_does_not_exist_yet_is_not_our_business():
    """整张表缺失由 create_all 负责；本脚本不越界建表。"""
    want = _model(Column("is_pixel_art", Boolean, nullable=True))
    eng = create_engine("sqlite://")
    assert plan(eng, want.metadata) == ([], [])


def test_it_fixes_the_real_case_a_live_table_missing_a_new_column():
    """本脚本存在的那个真实坏例:已上线的 windup_project 加了一列。

    合成表证明不了这条 —— 真实模型的查询会显式点名每一列,缺一列不是「新功能不生效」,
    是该表所有查询当场 UndefinedColumn。
    """
    from sqlalchemy.orm import Session
    from sqlalchemy.pool import StaticPool

    from windup_app.server.project.model import Project

    eng = create_engine("sqlite://", poolclass=StaticPool)
    Project.__table__.create(eng)
    new_column = "sprite_sample_url"          # 拿一个真实可空列当「刚加的那一列」
    with eng.begin() as conn:                  # 退回加列之前的库
        conn.execute(text(f"ALTER TABLE windup_project DROP COLUMN {new_column}"))
        conn.execute(text(
            "INSERT INTO windup_project (id, project_name, user_id, character_perspective,"
            " directional_movement, sprite_width, sprite_height, create_at, update_at)"
            " VALUES (1,'存量项目',1,1,0,256,256,'2026-01-01','2026-01-01')"
        ))

    with pytest.raises(Exception, match="sprite_sample_url"):
        with Session(eng) as s:
            s.query(Project).first()

    additive, manual = plan(eng, Project.metadata)
    assert manual == []
    assert (Project.__tablename__, new_column) in [(t, c) for t, c, _ in additive]

    with eng.begin() as conn:
        for tbl, _col, ddl in additive:
            conn.execute(text(f"ALTER TABLE {tbl} ADD COLUMN {ddl}"))

    with Session(eng) as s:
        assert s.query(Project).first().project_name == "存量项目"
    assert plan(eng, Project.metadata) == ([], []), "补完再跑应当无事可做"
