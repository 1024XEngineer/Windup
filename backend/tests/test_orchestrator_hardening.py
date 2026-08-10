"""编排层的五处加固（2026-08-10 机器审逮到，逐条锁死）。

共同点：全部在**测试全绿的情况下**存在——注入桩的测试走不到真实装配路径，
mock 的 EventBus 不涉及跨线程，请求模型的上界靠"没人会填大数"活着。
"""
from __future__ import annotations

import asyncio
import threading

import pytest

from windup_app.server.orchestrator._fetch import (
    MAX_FETCH_BYTES,
    FetchNotAllowed,
    fetch_own_media,
)
from windup_app.server.orchestrator.model import TaskStatus
from windup_app.web.api.generation import (
    _TERMINAL_EVENTS,
    CharacterActionGenerateRequest,
    CharacterImageGenerateRequest,
    _EventBus,
)


# ── ① 真实装配路径不能引用已删除的路线 ────────────────────────────────────


def test_real_generator_assembly_covers_every_declared_route():
    """曾多装一个 PROC_IDLE：该枚举与 ProcIdleStrategy 都已随「程序化待机放弃」
    删除，而装配那行留着，于是每个动作任务在 import 期 AttributeError。

    注入 generator 的测试走不到这条路径 —— 所以这条必须直接调真实装配。
    """
    from windup_common.models import GenRoute
    from windup_app.server.orchestrator.executor import ActionTaskExecutor

    gen = ActionTaskExecutor()._get_generator()
    wired = set(gen._by_route)
    assert wired == set(GenRoute), (
        f"GenRoute 声明了 {sorted(r.value for r in GenRoute)}，"
        f"装配了 {sorted(r.value for r in wired)} —— 漏装的路线一被请求就崩"
    )


# ── ② 服务端取图必须白名单 ────────────────────────────────────────────────


@pytest.mark.parametrize("evil", [
    "http://127.0.0.1:8000/auth/me",              # 打回自己，绕过鉴权中间件
    "http://169.254.169.254/latest/meta-data/",    # 云实例元数据服务
    "http://10.0.0.5/internal",                    # 私网探测
    "file:///etc/passwd",
    "http://[::1]:8000/",
])
def test_server_side_fetch_rejects_non_own_urls(evil: str, monkeypatch):
    """URL 来自已认证请求的请求体，直接 httpx.get 等于把服务器当跳板。"""
    import windup_app.server.orchestrator._fetch as F

    monkeypatch.setattr(F.storage_settings, "bucket_domain", "https://cdn.example.com")
    with pytest.raises(FetchNotAllowed):
        fetch_own_media(evil)


def test_server_side_fetch_refuses_when_storage_domain_unset(monkeypatch):
    """下载域名没配时不能"放行一切"——那等于白名单形同虚设。"""
    import windup_app.server.orchestrator._fetch as F

    monkeypatch.setattr(F.storage_settings, "bucket_domain", "")
    with pytest.raises(FetchNotAllowed, match="未配置"):
        fetch_own_media("https://cdn.example.com/a.png")


def test_prefix_match_is_not_fooled_by_a_lookalike_host(monkeypatch):
    """`cdn.example.com.evil.com` 不能因为前缀相似而通过。"""
    import windup_app.server.orchestrator._fetch as F

    monkeypatch.setattr(F.storage_settings, "bucket_domain", "https://cdn.example.com")
    with pytest.raises(FetchNotAllowed):
        fetch_own_media("https://cdn.example.com.evil.com/a.png")


def test_fetch_size_cap_is_bounded():
    """上限存在且是个有限的正数——无上限时一个指向大文件的 URL 就能吃光 worker 内存。"""
    assert 0 < MAX_FETCH_BYTES <= 64 * 1024 * 1024


# ── ③ 终态事件名必须与 SSE 契约一致 ──────────────────────────────────────


@pytest.mark.parametrize(("status", "expected"), [
    (TaskStatus.COMPLETED, "completed"),
    (TaskStatus.FAILED, "failed"),
    (TaskStatus.RUNNING, "task_update"),
])
def test_terminal_states_publish_terminal_event_names(status, expected, monkeypatch):
    """一律发 task_update 的话，stream 的终态判断永不成立：客户端收到 completed
    后连接仍开着，而端点带 retry: 3000，浏览器每 3 秒重连、重收同一条 completed。

    走**真实的 _publish_task_update 调用路径**，不读 _STATUS_EVENT 字典 —— 只断言
    字典内容的话，把 `event = _STATUS_EVENT.get(...)` 改成 `event = "task_update"`
    测试照样绿（2026-08-10 变异测试逮到这条是摆设）。
    """
    import windup_app.server.orchestrator.task_repo as R
    from windup_app.server.orchestrator.model import GenerationTask, GenerationType

    sent: list[str] = []

    class _Bus:
        def publish(self, task_id, event, data):
            sent.append(event)

    monkeypatch.setattr(R, "_event_bus", _Bus())
    R._publish_task_update(1, GenerationTask(
        id=1, user_id=1, task_type=GenerationType.CHARACTER_ACTION, status=status,
    ))
    assert sent == [expected]


def test_every_terminal_event_name_is_recognised_by_the_stream():
    """两边是一套契约的两半，任何一边改了名字必须让另一边失败。"""
    from windup_app.server.orchestrator.task_repo import _STATUS_EVENT

    assert set(_STATUS_EVENT.values()) == _TERMINAL_EVENTS


# ── ④ EventBus 跨线程投递 ────────────────────────────────────────────────


def test_publish_from_another_thread_delivers():
    """executor 在 daemon thread 里跑，队列属于处理 SSE 请求的那个 loop。

    诚实说明本用例的强度：它只证明跨线程发布**能到达**订阅者，**证不出**
    call_soon_threadsafe 是必需的 —— 实测在这个单队列场景里，裸 put_nowait
    跨线程也能被 get() 取到（CPython 的 Queue.get 在有元素时走快路径、不等唤醒）。
    去掉 call_soon_threadsafe 本用例照样绿（2026-08-10 变异测试逮到）。

    call_soon_threadsafe 仍然要留：asyncio.Queue 的文档明说它不是线程安全的，
    上面那个"能取到"是实现细节而非保证——多个 waiter、队列非空判定与唤醒之间
    的竞态都可能让它失效。真正的保证由下一条用例（订阅记录 loop）间接锁住。
    """
    bus = _EventBus()

    async def scenario():
        queue = await bus.subscribe(7)
        threading.Thread(
            target=bus.publish, args=(7, "completed", {"id": 7}), daemon=True,
        ).start()
        return await asyncio.wait_for(queue.get(), timeout=2.0)

    event, data = asyncio.run(scenario())
    assert event == "completed" and data["id"] == 7


def test_subscription_records_its_owning_loop():
    """订阅必须记下所属 loop —— 这是跨线程安全投递的前提。

    只存 queue 的话，publish 无从知道该把入队动作 marshal 回哪个 loop；
    不同订阅者可能来自不同 loop（多 worker / 测试里的临时 loop），存一个全局
    loop 也不行。本用例锁住"每个订阅都带着自己的 loop"这个结构。
    """
    bus = _EventBus()

    async def scenario():
        q = await bus.subscribe(11)
        subs = bus._queues["11"]
        assert len(subs) == 1
        queue, loop = subs[0]
        assert queue is q
        assert loop is asyncio.get_running_loop()

    asyncio.run(scenario())


def test_publish_to_a_closed_loop_is_dropped_not_raised():
    """客户端断连后请求 loop 已关闭。此时发布应静默丢弃——任务状态本身已落库，
    重连后靠 GET /tasks/{id} 取；让它抛异常会把后台任务整个带崩。
    """
    bus = _EventBus()

    async def sub():
        return await bus.subscribe(9)

    loop = asyncio.new_event_loop()
    queue = loop.run_until_complete(sub())
    loop.close()
    assert queue is not None
    bus.publish(9, "completed", {"id": 9})     # 不应抛


def test_unsubscribe_removes_only_that_queue():
    """订阅记的是 (queue, loop) 元组，退订不能顺手把同一任务的其他订阅者删掉。"""
    bus = _EventBus()

    async def scenario():
        q1 = await bus.subscribe(3)
        q2 = await bus.subscribe(3)
        await bus.unsubscribe(3, q1)
        bus.publish(3, "task_update", {"n": 1})
        got = await asyncio.wait_for(q2.get(), timeout=2.0)
        assert got[1]["n"] == 1
        assert q1.empty()

    asyncio.run(scenario())


# ── ⑤ 付费循环必须有上界 ─────────────────────────────────────────────────


def test_num_images_is_bounded_at_the_contract_layer():
    """num_images 是 provider 调用次数的循环上界：一个已认证请求填个大数就能
    绕过按请求计的限流，把成本拉到无上限。
    """
    with pytest.raises(ValueError):
        CharacterImageGenerateRequest(prompt="x", num_images=10_000)
    with pytest.raises(ValueError):
        CharacterImageGenerateRequest(prompt="x", num_images=0)
    assert CharacterImageGenerateRequest(prompt="x", num_images=2).num_images == 2


def test_image_dimensions_are_bounded():
    with pytest.raises(ValueError):
        CharacterImageGenerateRequest(prompt="x", width=100_000)
    with pytest.raises(ValueError):
        CharacterImageGenerateRequest(prompt="x", height=1)


def test_num_frames_is_bounded():
    """帧数决定抽帧与逐帧抠图的工作量。"""
    with pytest.raises(ValueError):
        CharacterActionGenerateRequest(character_id=1, action_type="walk", num_frames=100_000)
    with pytest.raises(ValueError):
        CharacterActionGenerateRequest(character_id=1, action_type="walk", num_frames=0)
    ok = CharacterActionGenerateRequest(character_id=1, action_type="walk", num_frames=16)
    assert ok.num_frames == 16


# ── ⑥ 请求里的尺寸必须真的生效（2026-08-10 对抗复查）────────────────────────


def _png(w: int, h: int) -> bytes:
    """带细节的图。纯色图在 NEAREST 与 LANCZOS 下产出完全相同,拿它验重采样是无效仪器
    (2026-08-10 第一版就是这么写的,测试立刻变红)。这里用 8px 棋盘格。"""
    import io

    import numpy as np
    from PIL import Image

    y, x = np.mgrid[0:h, 0:w]
    checker = (((x // 8) + (y // 8)) % 2 * 255).astype("uint8")
    arr = np.dstack([checker, 255 - checker, checker, np.full((h, w), 255, "uint8")])
    buf = io.BytesIO()
    Image.fromarray(arr, "RGBA").save(buf, "PNG")
    return buf.getvalue()


@pytest.mark.parametrize(("want_w", "want_h"), [(512, 512), (256, 384), (1024, 1024)])
def test_requested_image_size_is_actually_applied(want_w, want_h):
    """入口收下 width/height 并校验过，但 ImageProvider.gen_image 没有尺寸参数。

    此前模型出多大就返多大：调用方要 512×512、拿到 1024×1024，而请求被接受了 ——
    又一个"接了不履约"的字段。本用例锁住"要多大就得多大"。
    """
    import io

    from PIL import Image

    from windup_app.server.orchestrator.executor import ImageTaskExecutor
    from windup_app.server.orchestrator.model import CharacterImageInput

    class _Gen:
        def gen_image(self, prompt, refs):
            return _png(1024, 1024)          # 模型固定出 1024²

    got: list[bytes] = []
    ex = ImageTaskExecutor(image=_Gen(), upload=lambda b: (got.append(b), "u")[1])
    ex._produce_image(
        CharacterImageInput(prompt="knight", width=want_w, height=want_h, num_images=1),
        _constraints(),
    )
    assert Image.open(io.BytesIO(got[0])).size == (want_w, want_h)


def test_sprite_frames_and_master_use_different_resampling():
    """序列帧是像素画,必须 NEAREST;全彩母版用 NEAREST 缩图会明显锯齿。

    只断言两条路径产出不同 —— 同一张图两种重采样若字节相同,说明 smooth 参数没接上。
    """
    from windup_app.server.orchestrator.executor import _fit_to

    src = _png(1024, 1024)
    assert _fit_to(src, 256, 256, smooth=False) != _fit_to(src, 256, 256, smooth=True)


def _constraints():
    """最小项目约束(本文件只关心尺寸这条链路)。"""
    from windup_app.server.orchestrator.executor import _load_constraints  # noqa: F401
    from windup_app.server.orchestrator.executor import ProjectConstraints

    return ProjectConstraints()
