"""完整性错误不许一律冒充「项目名称已存在」。

拦的坏例:某一列是 NOT NULL 且无默认值,INSERT 不点名它就违约 → `IntegrityError`
→ 被当成并发重名。用户看到「项目名称已存在」,而那个名字是全新的;日志里刷
「创建并发重名」,真实原因不在任何一条日志里。

**比静默更糟:它给出一个自信且错误的诊断。** 值班会去查名字唯一性,而问题在别处。

这个形态是 #676 评审时在生产库上复现出来的 —— 那张表的 `character_perspective`
实测是 `smallint NOT NULL default=(无默认)`,而同表的 `auto_pixelate` 是有
`server_default` 的,说明本仓知道该怎么写。
"""
from __future__ import annotations

import pytest
from sqlalchemy.exc import IntegrityError

from windup_app.web.api.project import _NAME_UNIQUE, _is_duplicate_name


class _Orig(Exception):
    """模拟 DBAPI 的原始异常。psycopg 把 SQLSTATE 放在 sqlstate/pgcode 上。"""

    def __init__(self, text: str, sqlstate: str | None = None):
        super().__init__(text)
        self.sqlstate = sqlstate


def _err(text: str, sqlstate: str | None = None) -> IntegrityError:
    return IntegrityError("stmt", {}, _Orig(text, sqlstate))


def test_a_unique_violation_is_still_treated_as_a_duplicate_name():
    """正向:真重名照旧返回 400「项目名称已存在」,行为不变。"""
    assert _is_duplicate_name(_err(f'duplicate key value violates "{_NAME_UNIQUE}"', "23505"))


@pytest.mark.parametrize(
    "sqlstate,label",
    [("23502", "not_null"), ("23503", "foreign_key"), ("23514", "check")],
)
def test_a_non_unique_violation_is_not_called_a_duplicate_name(sqlstate, label):
    """拦的坏例:NOT NULL / 外键 / CHECK 违约被伪装成重名。

    23502 正是 #676 那个形态:列删了但库里还是 NOT NULL 无默认。
    """
    assert not _is_duplicate_name(
        _err(f'null value in column "character_perspective" violates {label}', sqlstate)
    )


def test_a_driver_without_sqlstate_falls_back_to_the_constraint_name():
    """SQLite 之类没有 SQLSTATE 的驱动,退回看约束名。"""
    assert _is_duplicate_name(_err(f"UNIQUE constraint failed: {_NAME_UNIQUE}"))
    assert not _is_duplicate_name(_err("NOT NULL constraint failed: windup_project.foo"))


def test_an_error_without_orig_keeps_the_old_behaviour():
    """判别不了就保守当重名 —— 那是原先的行为,不在判别不了的场合改变语义。"""
    e = IntegrityError("stmt", {}, None)
    assert _is_duplicate_name(e)


# ── 判别函数被用上了吗 ────────────────────────────────────────────────────
#
# 上面几条测的是 `_is_duplicate_name` 本身。但它可以完美地正确、而两个调用点
# 一个都没接 —— 实测:把 `if not _is_duplicate_name(exc)` 拆掉,全量 2008 条测试
# 依然全绿。判别对了没人用,和没判别是一回事。


def _new_project(name: str) -> dict:
    """建项目的最小合法请求体。缺必填字段会被 422 挡住,那时测的就不是本文件要测的东西了。"""
    return {"project_name": name, "directional_movement": 1,
            "sprite_width": 256, "sprite_height": 256}


def _fake_integrity(sqlstate: str, text: str) -> IntegrityError:
    return IntegrityError("stmt", {}, _Orig(text, sqlstate))


def test_creating_a_project_does_not_call_a_not_null_violation_a_duplicate(
    auth_client, monkeypatch,
):
    """拦的坏例:建项目时 NOT NULL 违约被报成「项目名称已存在」。

    这正是 2026-08-28 生产上的形状:`character_perspective` 在库里是 NOT NULL 无默认,
    而模型不再点名它(#676)。用户看到的名字是全新的,日志里刷「创建并发重名」。

    判据是**原始异常冒出来**(TestClient 不吞异常),而不是被翻译成 400 重名。
    修复前这里拿到的是 `{"code": 400, "message": "项目名称已存在"}`。
    """
    from windup_app.web.api import project as papi

    def _boom(*a, **k):
        raise _fake_integrity(
            "23502", 'null value in column "character_perspective" violates not-null')

    monkeypatch.setattr(papi.service, "create_project", _boom)
    with pytest.raises(IntegrityError):
        auth_client.post("/projects", json=_new_project("全新的名字-不可能重复"))


def test_renaming_a_project_does_not_call_other_violations_a_duplicate(
    auth_client, monkeypatch,
):
    """改名那一处是第二个调用点。两处都要接 —— 只接一处等于漏了一半。"""
    from windup_app.web.api import project as papi

    created = auth_client.post("/projects", json=_new_project("原名")).json()
    data = created.get("data")
    if isinstance(data, list):
        data = data[0] if data else None
    pid = (data or {}).get("id") if isinstance(data, dict) else None
    assert pid is not None, f"建项目没拿到 id：{created}"

    def _boom(*a, **k):
        raise _fake_integrity("23503", "insert or update violates foreign key")

    monkeypatch.setattr(papi.service, "update_project", _boom)
    with pytest.raises(IntegrityError):
        auth_client.patch(f"/projects/{pid}", json={"project_name": "新名"})


def test_a_real_duplicate_still_gets_the_friendly_400(auth_client):
    """反向对照:**真**重名仍然是那句友好的 400,行为一个字不变。

    没有这一条的话,把两个调用点的判别整个删掉(全部原样抛出)也能让上面两条绿 ——
    而那会把一个用户改得动的错变成 500。
    """
    body = _new_project("同名项目")
    assert auth_client.post("/projects", json=body).json().get("code") == 200
    again = auth_client.post("/projects", json=body).json()
    assert again.get("message") == "项目名称已存在", again
