"""SSE 订阅的归属校验与终态预检。

两条都是"测试全绿的情况下"存在的缺口：
- 主线 #110 已经校验了"项目属于当前用户"，但**没有**校验"任务属于那个项目"。缺这一道，
  任意已认证用户拿自己的 project_id 配上别人的 task_id 就能订阅到别人的流，而事件体带
  result，即最终帧的对象存储 URL。
- 终态预检原先是一行 TODO，而端点 docstring 已经承诺了该行为 —— 读文档的人不会发现，
  实际表现是客户端要先挂满一次心跳超时才拿到终态。

归属口径沿用主线：靠 project_id 而不是任务自己的 user_id。我此前那版删掉了 project_id
改用 task.user_id，方向是错的 —— project_id 在主线里正是归属校验的依据，且 EventBus
按 (project_id, task_id) 双键隔离，删掉它会退化主线已有的能力。
"""
from __future__ import annotations

import asyncio
import json

import pytest
from sqlalchemy.orm import sessionmaker

from windup_app.server.orchestrator import task_repo
from windup_app.server.orchestrator.model import GenerationType, TaskStatus

# SSE 事件体的键集是**对外契约**，故在这里写死。
# 不要用 task_event_payload(task) 反算期望值 —— 那样两边同源，删字段时一起变、断言永远
# 成立（2026-08-11 变异测试逮到第一版正是如此：删掉 error_message 仍全绿）。
_EVENT_KEYS = {
    "id", "user_id", "project_id", "task_type",
    "status", "input_payload", "result", "error_message",
}


def _create_project(client, name: str = "SSE 项目") -> dict:
    return client.post("/projects", json={
        "project_name": name,
        "character_perspective": 1,
        "directional_movement": 2,
        "sprite_width": 64,
        "sprite_height": 64,
    }).json()["data"]


@pytest.fixture()
def session(engine):
    """绑定测试 engine 的 session，并补建 generation_task 表。

    conftest 的 ``engine`` fixture 只建了 project / user / character / workflow_run
    四张，本 PR 新引入的这张不在那份清单里。在这里补建而不是改公共 fixture，
    是为了不影响其它测试文件的建表集合。
    """
    from sqlalchemy.orm import sessionmaker

    from windup_app.server.orchestrator.model import GenerationTaskRecord
    from windup_framework.db import Base

    Base.metadata.create_all(engine, tables=[GenerationTaskRecord.__table__])
    s = sessionmaker(bind=engine, expire_on_commit=False)()
    yield s
    s.close()


def _make_task(session, *, user_id: int, project_id: int,
               status: TaskStatus = TaskStatus.PENDING) -> int:
    """直接落一条任务，绕过端点（端点会真的起后台线程去跑生成）。"""
    task = task_repo.create_task(
        session,
        user_id=user_id,
        project_id=project_id,
        task_type=GenerationType.CHARACTER_IMAGE,
        input_payload={"prompt": "x"},
    )
    if status is not TaskStatus.PENDING:
        task_repo.update_status(session, task.id, status)
    session.commit()
    return task.id


# ── ① 任务必须属于所声明的项目 ──────────────────────────────────────────────


def test_task_from_another_project_cannot_be_subscribed(auth_client, session):
    """主线只校验了"项目属于我"，没校验"任务属于该项目"。

    缺这一道：**用自己的项目 id 配别人的任务 id** 就能订阅到别人的流。本用例用同一个
    用户的两个项目复现，因此排除了"项目归属校验挡住了"这种解释 —— 两个项目都属于我，
    唯一的区别是任务不在我声明的那个项目里。
    """
    mine = _create_project(auth_client, "我的项目")
    other = _create_project(auth_client, "另一个项目")
    task_id = _make_task(session, user_id=1, project_id=other["id"],
                         status=TaskStatus.COMPLETED)

    with auth_client.stream(
        "GET", f"/generation/tasks/{task_id}/stream",
        params={"project_id": mine["id"]},
    ) as r:
        body = r.read().decode()
    assert "event: " not in body, f"跨项目订阅拿到了事件流：{body[:200]}"


def test_task_in_the_declared_project_is_subscribable(auth_client, session):
    """对照组：任务确实在所声明的项目里时必须放行 —— 否则上一条可能只是全都拒了。"""
    project = _create_project(auth_client)
    task_id = _make_task(session, user_id=1, project_id=project["id"],
                         status=TaskStatus.COMPLETED)

    with auth_client.stream(
        "GET", f"/generation/tasks/{task_id}/stream",
        params={"project_id": project["id"]},
    ) as r:
        body = r.read().decode()
    assert "event: completed" in body, body[:200]


def test_rejection_happens_before_subscribing(auth_client, session):
    """校验必须在 subscribe **之前**。

    放在之后的话，越权请求仍会在 EventBus 上挂一个订阅者 —— 它照样收到事件，只是响应体
    被丢弃；订阅表还会因为没人 unsubscribe 而增长。
    """
    from windup_app.web.api.generation import event_bus

    mine = _create_project(auth_client, "我的项目")
    other = _create_project(auth_client, "另一个项目")
    task_id = _make_task(session, user_id=1, project_id=other["id"])

    with auth_client.stream(
        "GET", f"/generation/tasks/{task_id}/stream",
        params={"project_id": mine["id"]},
    ) as r:
        r.read()
    key = (mine["id"], task_id)
    assert not event_bus._queues.get(key), "越权请求在 EventBus 上留下了订阅者"


# ── ② 终态预检 ─────────────────────────────────────────────────────────────


@pytest.mark.parametrize(("status", "expected"), [
    (TaskStatus.COMPLETED, "event: completed"),
    (TaskStatus.PARTIAL, "event: partial"),
    (TaskStatus.FAILED, "event: failed"),
])
def test_already_terminal_task_gets_its_event_immediately(auth_client, session, status, expected):
    """订阅时任务已终结 → 立即推终态并关闭，而不是先挂满一次心跳超时。"""
    project = _create_project(auth_client)
    task_id = _make_task(session, user_id=1, project_id=project["id"], status=status)

    with auth_client.stream(
        "GET", f"/generation/tasks/{task_id}/stream",
        params={"project_id": project["id"]},
    ) as r:
        body = r.read().decode()
    assert expected in body, body[:300]
    assert "heartbeat" not in body, "先发了心跳 = 没有走终态预检"


def test_terminal_event_body_matches_the_documented_contract(auth_client, session):
    """订阅时补发的终态事件，键集必须与契约一致。"""
    project = _create_project(auth_client)
    task_id = _make_task(session, user_id=1, project_id=project["id"],
                         status=TaskStatus.COMPLETED)

    with auth_client.stream(
        "GET", f"/generation/tasks/{task_id}/stream",
        params={"project_id": project["id"]},
    ) as r:
        body = r.read().decode()
    line = next(x for x in body.splitlines() if x.startswith("data: "))
    assert set(json.loads(line[6:])) == _EVENT_KEYS


def test_both_send_paths_use_the_same_payload_builder(session):
    """运行中推送与终态补发必须同形状 —— 两处各抄一份字段列表迟早分叉。

    直接比两条真实路径的产出：``_publish_task_update``（运行中）与
    ``task_event_payload``（终态预检用的那个）。
    """
    task_id = _make_task(session, user_id=1, project_id=42, status=TaskStatus.COMPLETED)
    task = task_repo.get_task(session, task_id)

    sent: list[dict] = []

    class _Bus:
        def publish(self, project_id, tid, event, data):
            sent.append(data)

    old_publisher = task_repo._task_event_publisher

    class _Publisher:
        def publish(self, project_id, tid, event, data):
            sent.append(data)

    task_repo._task_event_publisher = _Publisher()
    try:
        task_repo._publish_task_update(task_id, task)
    finally:
        task_repo._task_event_publisher = old_publisher

    assert set(sent[0]) == _EVENT_KEYS
    assert set(task_repo.task_event_payload(task)) == _EVENT_KEYS


@pytest.mark.parametrize("status", [TaskStatus.PENDING, TaskStatus.RUNNING])
def test_non_terminal_status_is_not_mistaken_for_terminal(status):
    """非终态不能被预检判成终态，否则连接刚建立就被关掉。

    **本条不走 HTTP，如实说明原因**：非终态的流是无限心跳，靠
    ``request.is_disconnected()`` 退出，而 TestClient 下它不会变 True —— 生成器永不
    结束，TestClient 在 teardown 上阻塞（第一版这么写，把 pytest 挂满 10 分钟）。
    压低心跳间隔也无效，因为挂的不是等待、是退出条件。

    所以这里直接测预检用的那个判据函数。它是终态预检的唯一入口，改坏了上面那几条终态
    用例会红，因此覆盖不算空缺。
    """
    from windup_app.server.orchestrator.model import GenerationTask

    task = GenerationTask(id=1, user_id=1, project_id=42,
                          task_type=GenerationType.CHARACTER_IMAGE, status=status)
    assert task_repo.terminal_event_for(task) is None


def test_terminal_snapshot_returns_payload_for_completed_task(session):
    """heartbeat 查库兜底：终态任务应能补发 completed 事件。"""
    task_id = _make_task(
        session,
        user_id=1,
        project_id=42,
        status=TaskStatus.COMPLETED,
    )
    snap = task_repo.terminal_snapshot(session, task_id, project_id=42)
    assert snap is not None
    event, payload = snap
    assert event == "completed"
    assert payload["id"] == task_id
    assert payload["status"] == TaskStatus.COMPLETED.value


def test_terminal_snapshot_ignores_non_terminal(session):
    task_id = _make_task(session, user_id=1, project_id=42, status=TaskStatus.RUNNING)
    assert task_repo.terminal_snapshot(session, task_id, project_id=42) is None


def test_stream_sends_heartbeat_before_terminal_snapshot_poll(monkeypatch):
    """代理空闲边界前先发心跳，较慢的数据库兜底查询不能阻塞保活。"""
    from windup_app.web.api import generation as gen

    polls: list[tuple[int, int]] = []

    def poll(task_id: int, project_id: int):
        polls.append((task_id, project_id))
        return "completed", {"id": task_id}

    monkeypatch.setattr(gen, "_poll_terminal_snapshot", poll)

    class _ConnectedRequest:
        async def is_disconnected(self):
            return False

    async def scenario():
        queue = asyncio.Queue()
        events = gen._stream_events(
            request=_ConnectedRequest(),
            queue=queue,
            task_id=7,
            project_id=42,
            heartbeat_seconds=0.001,
            terminal_poll_seconds=0,
        )
        first = await anext(events)
        assert polls == []
        second = await anext(events)
        await events.aclose()
        return first, second

    first, second = asyncio.run(scenario())
    assert first == ": heartbeat\n\n"
    assert second.startswith("event: completed\n")
    assert polls == [(7, 42)]


def test_sse_interval_rejects_nan_and_infinity(monkeypatch):
    from windup_app.web.api import generation as gen

    monkeypatch.setenv("WINDUP_TEST_INTERVAL", "nan")
    assert gen._positive_interval("WINDUP_TEST_INTERVAL", 10.0) == 10.0
    monkeypatch.setenv("WINDUP_TEST_INTERVAL", "inf")
    assert gen._positive_interval("WINDUP_TEST_INTERVAL", 10.0) == 10.0


def test_stream_start_closes_session_before_returning(engine, session):
    """SSE 预检必须归还连接,否则压测十几路进度流打满 QueuePool,前端报错。"""
    from conftest import insert_project
    from windup_app.web.api import generation as gen

    project = insert_project(session, user_id=1)
    session.commit()
    task_id = _make_task(
        session,
        user_id=1,
        project_id=project.id,
        status=TaskStatus.COMPLETED,
    )

    closed: list[bool] = []
    factory = sessionmaker(bind=engine, expire_on_commit=False)

    def SessionLocal():
        inner = factory()
        orig = inner.close

        def close():
            closed.append(True)
            orig()

        inner.close = close
        return inner

    previous = gen.SessionLocal
    gen.SessionLocal = SessionLocal
    try:
        event, payload = gen._load_stream_start(
            user_id=1,
            project_id=project.id,
            task_id=task_id,
        )
    finally:
        gen.SessionLocal = previous

    assert event == "completed"
    assert payload is not None and payload["id"] == task_id
    assert closed == [True]


# ── ③ project_id 为空的任务发不出事件，要记 warning 而不是静默丢 ──────────────


def test_task_without_project_id_logs_instead_of_publishing_into_the_void(session, caplog):
    """EventBus 按 (project_id, task_id) 索引，project_id 为空就发不到任何订阅者。

    静默 publish 出去的话，现象是"任务确实在跑、状态也在落库，但前端进度条一动不动"，
    而日志里一行异常都没有 —— 属于最难查的那类静默失败。
    """
    import logging

    task_id = _make_task(session, user_id=1, project_id=42)
    task = task_repo.get_task(session, task_id)
    task.project_id = None

    sent: list = []

    class _Bus:
        def publish(self, *a):
            sent.append(a)

    old_publisher = task_repo._task_event_publisher

    class _Publisher:
        def publish(self, *a):
            sent.append(a)

    task_repo._task_event_publisher = _Publisher()
    try:
        with caplog.at_level(logging.WARNING):
            task_repo._publish_task_update(task_id, task)
    finally:
        task_repo._task_event_publisher = old_publisher

    assert sent == [], "不该发到一个没人听的键上"
    assert any("project_id" in r.message for r in caplog.records), "应记 warning"
