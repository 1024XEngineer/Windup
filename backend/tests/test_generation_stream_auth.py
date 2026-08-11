"""SSE 订阅的归属校验与终态预检（2026-08-11 人工评审逮到）。

两条都是"测试全绿的情况下"存在的：
- 越权订阅没有任何用例覆盖 —— 同文件的 GET /tasks/{task_id} 有校验，stream 漏了，
  而两者没有任何一条测试把它们放在一起比过；
- 终态预检是一行 TODO，但 docstring 已经承诺了该行为，读文档的人不会发现。
"""
from __future__ import annotations

import pytest

from windup_app.server.orchestrator import task_repo
from windup_app.server.orchestrator.model import GenerationType, TaskStatus


def _make_task(session, user_id: int, status: TaskStatus = TaskStatus.PENDING) -> int:
    """直接落一条任务，绕过端点（端点会真的起后台线程去跑生成）。"""
    task = task_repo.create_task(
        session,
        user_id=user_id,
        project_id=None,
        task_type=GenerationType.CHARACTER_IMAGE,
        input_payload={"prompt": "x"},
    )
    if status is not TaskStatus.PENDING:
        task_repo.update_status(session, task.id, status)
    session.commit()
    return task.id


@pytest.fixture()
def session(engine):
    """绑定到测试 engine 的 session。

    额外建 generation_task 表：conftest 的 ``engine`` fixture 只建了 project / user /
    character / workflow_run 四张，本 PR 新引入的这张没进那份清单。在这里补建而不是改
    公共 fixture，是为了不影响其它测试文件的建表集合。
    """
    from sqlalchemy.orm import sessionmaker

    from windup_app.server.orchestrator.model import GenerationTaskRecord
    from windup_framework.db import Base

    Base.metadata.create_all(engine, tables=[GenerationTaskRecord.__table__])
    s = sessionmaker(bind=engine, expire_on_commit=False)()
    yield s
    s.close()


# ── ① 越权订阅必须被拒 ──────────────────────────────────────────────────────


def test_another_user_cannot_subscribe_to_my_task_stream(auth_client, auth_client_b, session):
    """任意已认证用户猜到 task_id 就能拿到别人任务的实时进度与产物 URL。

    这是**授权绕过**，不是信息层面的小瑕疵：SSE 事件体里带 result，即最终帧的
    对象存储 URL。
    """
    task_id = _make_task(session, user_id=1)

    # 本仓的 BizException 统一以 **HTTP 200 + 业务码** 返回，故判据看 body 的 data
    # 是否为空，不看 HTTP status（第一版按 status_code 断言，把"校验生效"误判成
    # "越权"；成功码也不是 0 而是 200，所以也别按 code==0 判）。
    mine = auth_client.get(f"/generation/tasks/{task_id}").json()
    assert mine["data"] is not None, mine   # 对照组：任务确实存在、路由确实通
    theirs = auth_client_b.get(f"/generation/tasks/{task_id}").json()
    assert theirs["data"] is None, theirs

    with auth_client_b.stream("GET", f"/generation/tasks/{task_id}/stream") as r:
        body = r.read().decode()
    assert "event: " not in body, f"越权订阅拿到了事件流：{body[:200]}"


def test_rejection_happens_before_subscribing(auth_client_b, session):
    """校验必须在 subscribe **之前**。

    放在之后的话，越权请求仍会在 EventBus 上挂一个订阅者 —— 它照样收到事件，
    只是响应体被丢弃；订阅表还会因为没人 unsubscribe 而增长。
    """
    from windup_app.web.api.generation import event_bus

    task_id = _make_task(session, user_id=1)
    with auth_client_b.stream("GET", f"/generation/tasks/{task_id}/stream") as r:
        r.read()
    assert str(task_id) not in event_bus._queues or not event_bus._queues[str(task_id)], \
        "越权请求在 EventBus 上留下了订阅者"


# ── ② 终态预检 ─────────────────────────────────────────────────────────────


@pytest.mark.parametrize(("status", "expected"), [
    (TaskStatus.COMPLETED, "event: completed"),
    (TaskStatus.FAILED, "event: failed"),
])
def test_already_terminal_task_gets_its_event_immediately(auth_client, session, status, expected):
    """订阅时任务已终结 → 立即推终态并关闭。

    此前是一行 TODO：客户端要先挂满一次心跳超时才拿到终态。
    读取带超时：行为退回去时用例会超时失败，而不是把整个测试进程挂死
    （2026-08-11 第一版没设超时，pytest 被挂满 10 分钟）。
    """
    task_id = _make_task(session, user_id=1, status=status)
    with auth_client.stream("GET", f"/generation/tasks/{task_id}/stream") as r:
        body = r.read().decode()
    assert expected in body, body[:300]
    assert "heartbeat" not in body, "先发了心跳 = 没有走终态预检"


# SSE 事件体的键集是**对外契约**，故在这里写死。
# 不要用 task_event_payload(task) 反算期望值 —— 那样两边同源，删字段时一起变、
# 断言永远成立（2026-08-11 变异测试逮到第一版正是如此：删掉 error_message 仍全绿）。
_EVENT_KEYS = {
    "id", "user_id", "project_id", "task_type",
    "status", "input_payload", "result", "error_message",
}


def test_terminal_event_body_matches_the_documented_contract(auth_client, session):
    """订阅时补发的终态事件，键集必须与契约一致。"""
    import json

    task_id = _make_task(session, user_id=1, status=TaskStatus.COMPLETED)
    with auth_client.stream("GET", f"/generation/tasks/{task_id}/stream") as r:
        body = r.read().decode()
    line = next(x for x in body.splitlines() if x.startswith("data: "))
    assert set(json.loads(line[6:])) == _EVENT_KEYS


def test_both_send_paths_use_the_same_payload_builder(session):
    """运行中推送与终态补发必须同形状 —— 两处各抄一份字段列表迟早分叉。

    直接比两条真实路径的产出：``_publish_task_update``（运行中）与
    ``task_event_payload``（终态预检用的那个）。
    """
    task_id = _make_task(session, user_id=1, status=TaskStatus.COMPLETED)
    task = task_repo.get_task(session, task_id)

    sent: list[dict] = []

    class _Bus:
        def publish(self, tid, event, data):
            sent.append(data)

    old_bus = task_repo._event_bus
    task_repo._event_bus = _Bus()
    try:
        task_repo._publish_task_update(task_id, task)
    finally:
        task_repo._event_bus = old_bus

    assert set(sent[0]) == _EVENT_KEYS
    assert set(task_repo.task_event_payload(task)) == _EVENT_KEYS


@pytest.mark.parametrize("status", [TaskStatus.PENDING, TaskStatus.RUNNING])
def test_non_terminal_status_is_not_mistaken_for_terminal(status):
    """非终态不能被预检判成终态，否则连接刚建立就被关掉。

    **本条不走 HTTP，如实说明原因**：非终态的流是无限心跳，靠 ``request.is_disconnected()``
    退出，而 TestClient 下它不会变 True —— 生成器永不结束，TestClient 在 teardown 上
    阻塞（2026-08-11 第一版这么写，把 pytest 挂满 10 分钟）。压低心跳间隔也无效，
    因为挂的不是等待、是退出条件。

    所以这里直接测预检用的那个判据函数。它是终态预检的唯一入口，改坏了上面那几条
    终态用例会红，因此覆盖不算空缺。
    """
    from windup_app.server.orchestrator.model import GenerationTask

    task = GenerationTask(id=1, user_id=1, task_type=GenerationType.CHARACTER_IMAGE,
                          status=status)
    assert task_repo.terminal_event_for(task) is None


# ── ③ project_id 已移除 ────────────────────────────────────────────────────


def test_stream_no_longer_requires_an_unused_project_id(auth_client, session):
    """它声明为必填但从未被使用，归属判定的依据是任务自己的 user_id。

    留着等于要求客户端传一个不影响任何结果的必填参数 —— 传错了也照样通过。
    """
    task_id = _make_task(session, user_id=1, status=TaskStatus.COMPLETED)
    r = auth_client.get(f"/generation/tasks/{task_id}/stream")
    assert r.status_code == 200, "不传 project_id 应当可用"
