"""项目写入的完整性错误必须原样暴露。

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


class _Orig(Exception):
    """模拟 DBAPI 的原始异常。psycopg 把 SQLSTATE 放在 sqlstate/pgcode 上。"""

    def __init__(self, text: str, sqlstate: str | None = None):
        super().__init__(text)
        self.sqlstate = sqlstate


def _new_project(name: str) -> dict:
    """建项目的最小合法请求体。缺必填字段会被 422 挡住,那时测的就不是本文件要测的东西了。"""
    return {
        "project_name": name,
        "directional_movement": 1,
        "sprite_width": 256,
        "sprite_height": 256,
    }


def _fake_integrity(sqlstate: str, text: str) -> IntegrityError:
    return IntegrityError("stmt", {}, _Orig(text, sqlstate))


def test_creating_a_project_does_not_call_a_not_null_violation_a_duplicate(
    auth_client,
    monkeypatch,
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
            "23502", 'null value in column "character_perspective" violates not-null'
        )

    monkeypatch.setattr(papi.service, "create_project", _boom)
    with pytest.raises(IntegrityError):
        auth_client.post("/projects", json=_new_project("全新的名字-不可能重复"))


def test_renaming_a_project_does_not_call_other_violations_a_duplicate(
    auth_client,
    monkeypatch,
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
