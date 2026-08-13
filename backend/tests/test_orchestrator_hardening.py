"""编排层的加固用例。

EventBus 的键是 ``(project_id, task_id)``（主线 #110：同一 task_id 在不同项目下互不
串流）。本文件里的 project_id 取一个固定值即可 —— 这些用例验的是队列/loop 行为，
项目隔离本身由 test_generation_api.py 的专用用例覆盖。

原始标题：编排层的五处加固（2026-08-10 机器审逮到，逐条锁死）。

共同点：全部在**测试全绿的情况下**存在——注入桩的测试走不到真实装配路径，
mock 的 EventBus 不涉及跨线程，请求模型的上界靠"没人会填大数"活着。
"""
from __future__ import annotations

import asyncio
import threading
from unittest.mock import Mock

import httpx
import pytest

from windup_app.server.media.model import MediaUploadInput
from windup_app.server.media.service import ObjectStorageMediaService
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
from windup_common.enums.media import MediaCategory
from windup_framework.config.storage import StorageSettings


@pytest.mark.parametrize(
    ("configured", "expected"),
    [
        ("cdn.example.com", "https://cdn.example.com"),
        ("https://cdn.example.com/", "https://cdn.example.com"),
        ("", ""),
    ],
)
def test_storage_download_base_accepts_documented_bare_domain(configured, expected):
    assert StorageSettings(bucket_domain=configured).download_base == expected


@pytest.mark.parametrize(
    "configured",
    [
        "example-bucket.s3.cn-east-1.qiniucs.com",
        "https://example-bucket.s3.cn-east-1.qiniucs.com",
        "https://s3-cn-east-1.qiniucs.com/example-bucket",
    ],
)
def test_storage_download_base_rejects_qiniu_s3_api_endpoint(configured):
    with pytest.raises(ValueError, match="S3 API"):
        StorageSettings(bucket_domain=configured).download_base


def test_media_upload_rejects_s3_endpoint_before_uploading(monkeypatch):
    import qiniu
    import windup_app.server.media.service as media_service_module

    monkeypatch.setattr(
        media_service_module.storage_settings,
        "bucket_domain",
        "https://example-bucket.s3.cn-east-1.qiniucs.com",
    )
    put_data = Mock()
    monkeypatch.setattr(qiniu, "put_data", put_data)

    metadata = MediaUploadInput(
        filename="character.png",
        content_type="image/png",
        size=3,
        category=MediaCategory.REFERENCE_IMAGE,
    )
    with pytest.raises(ValueError, match="S3 API"):
        ObjectStorageMediaService().upload(b"png", metadata)

    put_data.assert_not_called()


def test_media_upload_uses_validated_download_base(monkeypatch):
    import qiniu
    import windup_app.server.media.service as media_service_module

    monkeypatch.setattr(
        media_service_module.storage_settings,
        "bucket_domain",
        "cdn.example.com",
    )
    monkeypatch.setattr(
        media_service_module.storage_settings,
        "bucket_name",
        "example-bucket",
    )
    auth = Mock()
    auth.upload_token.return_value = "upload-token"
    monkeypatch.setattr(qiniu, "Auth", Mock(return_value=auth))
    response = Mock(status_code=200)
    put_data = Mock(return_value=({"key": "uploaded"}, response))
    monkeypatch.setattr(qiniu, "put_data", put_data)

    metadata = MediaUploadInput(
        filename="character.png",
        content_type="image/png",
        size=3,
        category=MediaCategory.REFERENCE_IMAGE,
    )
    result = ObjectStorageMediaService().upload(b"png", metadata)

    assert result.url == f"https://cdn.example.com/{result.object_key}"
    auth.upload_token.assert_called_once_with("example-bucket", result.object_key)
    put_data.assert_called_once_with(
        "upload-token",
        result.object_key,
        b"png",
        mime_type="image/png",
    )


# ── ① 真实装配路径不能引用已删除的路线 ────────────────────────────────────


def test_real_generator_assembly_covers_every_declared_route():
    """曾多装一个 PROC_IDLE：该枚举与 ProcIdleStrategy 都已随「程序化待机放弃」
    删除，而装配那行留着，于是每个动作任务在 import 期 AttributeError。

    注入 generator 的测试走不到这条路径 —— 所以这条必须直接调真实装配。
    """
    # RENDER_3D 这条路线的 provider 在 1024XEngineer/Windup#270。缺件时装配必然少一条,
    # 断言必红 —— 那是缺件不是漏装,所以显式跳过而不是放宽断言。
    pytest.importorskip(
        "windup_framework.providers.render3d",
        reason="缺三渲二 provider 层(1024XEngineer/Windup#270),RENDER_3D 无法装配",
    )
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


# 下面四条覆盖**真正下载那一段**。此前只测了"坏 URL 被拒",而放行之后的三条防线
# (不跟重定向 / 声明超限 / 声明撒谎时边读边截)一行都没跑过 —— 而它们恰恰是
# 白名单被绕过时唯一的兜底。用 MockTransport,不联网。


def _install_mock_client(monkeypatch, handler):
    """把 _fetch 模块里的 httpx.Client 换成走 MockTransport 的,并记录构造参数。"""
    import windup_app.server.orchestrator._fetch as F

    seen: dict = {}
    real_client = httpx.Client          # 必须先抓真的:补丁装上后 httpx.Client 就是 factory 自己

    def factory(*args, **kw):
        seen.update(kw)
        return real_client(
            transport=httpx.MockTransport(handler),
            follow_redirects=bool(kw.get("follow_redirects", False)),
        )

    monkeypatch.setattr(F.httpx, "Client", factory)
    return seen


def test_fetch_returns_body_for_own_url(monkeypatch):
    import windup_app.server.orchestrator._fetch as F

    monkeypatch.setattr(F.storage_settings, "bucket_domain", "https://cdn.example.com")
    _install_mock_client(monkeypatch, lambda req: httpx.Response(200, content=b"PNGDATA"))
    assert fetch_own_media("https://cdn.example.com/a.png") == b"PNGDATA"


def test_fetch_does_not_follow_redirects(monkeypatch):
    """自家域名返回 302 指向别处时**不许跟过去** —— 跟了白名单就等于没有。

    这条是白名单最容易被绕开的方式:URL 本身完全合规,坏事发生在重定向之后。
    """
    import windup_app.server.orchestrator._fetch as F

    monkeypatch.setattr(F.storage_settings, "bucket_domain", "https://cdn.example.com")
    asked: list[str] = []

    def handler(req):
        asked.append(str(req.url))
        if "cdn.example.com" in str(req.url):
            return httpx.Response(302, headers={"location": "http://169.254.169.254/latest/meta-data/"})
        return httpx.Response(200, content=b"SECRET")

    seen = _install_mock_client(monkeypatch, handler)
    # 断言具体异常类型,不用裸 Exception —— 那样连 RecursionError 都算"通过",
    # 测试会因为错误的原因变绿(本条初版就栽在这)。
    with pytest.raises(httpx.HTTPStatusError):          # 3xx 不是 success,raise_for_status 会抛
        fetch_own_media("https://cdn.example.com/a.png")
    assert seen.get("follow_redirects") is False, "构造 Client 时必须显式关掉重定向"
    assert not any("169.254.169.254" in u for u in asked), f"跟着重定向打到了元数据服务: {asked}"


def test_fetch_rejects_declared_oversize_before_reading_body(monkeypatch):
    import windup_app.server.orchestrator._fetch as F

    monkeypatch.setattr(F.storage_settings, "bucket_domain", "https://cdn.example.com")
    too_big = str(MAX_FETCH_BYTES + 1)
    _install_mock_client(
        monkeypatch,
        lambda req: httpx.Response(200, headers={"content-length": too_big}, content=b"x"),
    )
    with pytest.raises(FetchNotAllowed, match="超过上限"):
        fetch_own_media("https://cdn.example.com/big.png")


def test_fetch_rejects_when_content_length_lies(monkeypatch):
    """Content-Length 可以缺失或撒谎,所以必须边读边计数。

    只信 Content-Length 的话,声明 1 字节、实际吐 100MB 就能吃光 worker 内存。
    """
    import windup_app.server.orchestrator._fetch as F

    monkeypatch.setattr(F.storage_settings, "bucket_domain", "https://cdn.example.com")
    monkeypatch.setattr(F, "MAX_FETCH_BYTES", 1024)
    _install_mock_client(
        monkeypatch,
        lambda req: httpx.Response(200, headers={"content-length": "1"}, content=b"x" * 4096),
    )
    with pytest.raises(FetchNotAllowed, match="超过上限"):
        fetch_own_media("https://cdn.example.com/liar.png")


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
        def publish(self, project_id, task_id, event, data):
            sent.append(event)

    monkeypatch.setattr(R, "_event_bus", _Bus())
    # 必须带 project_id：EventBus 按 (project_id, task_id) 索引，_publish_task_update
    # 对 project_id 为空的任务会记 warning 并早退（发到没人听的键上等于静默失败）。
    R._publish_task_update(1, GenerationTask(
        id=1, user_id=1, project_id=42,
        task_type=GenerationType.CHARACTER_ACTION, status=status,
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

    call_soon_threadsafe 仍然要留：asyncio.Queue 的文档明说它不是线程安全的，
    上面那个"能取到"是实现细节而非保证——多个 waiter、队列非空判定与唤醒之间
    的竞态都可能让它失效。真正的保证由下一条用例（订阅记录 loop）间接锁住。

    先等发布线程真的调完再取（用一个 future 同步），否则测的是"抢跑运气"而不是投递：
    publish 走的是跨 loop 分支，marshal 回来要等 loop 一次迭代。
    """
    bus = _EventBus()

    async def scenario():
        queue = await bus.subscribe(42, 7)
        loop = asyncio.get_running_loop()
        published = loop.create_future()

        def publish_from_thread():
            bus.publish(42, 7, "completed", {"id": 7})
            loop.call_soon_threadsafe(published.set_result, None)

        threading.Thread(target=publish_from_thread, daemon=True).start()
        await asyncio.wait_for(published, timeout=3.0)
        return await asyncio.wait_for(queue.get(), timeout=3.0)

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
        q = await bus.subscribe(42, 11)
        subs = bus._queues[(42, 11)]
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
        return await bus.subscribe(42, 9)

    loop = asyncio.new_event_loop()
    queue = loop.run_until_complete(sub())
    loop.close()
    assert queue is not None
    bus.publish(42, 9, "completed", {"id": 9})     # 不应抛


def test_unsubscribe_removes_only_that_queue():
    """订阅记的是 (queue, loop) 元组，退订不能顺手把同一任务的其他订阅者删掉。"""
    bus = _EventBus()

    async def scenario():
        q1 = await bus.subscribe(42, 3)
        q2 = await bus.subscribe(42, 3)
        await bus.unsubscribe(42, 3, q1)
        bus.publish(42, 3, "task_update", {"n": 1})
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
        CharacterImageGenerateRequest(project_id=42, prompt="x", num_images=10_000)
    with pytest.raises(ValueError):
        CharacterImageGenerateRequest(project_id=42, prompt="x", num_images=0)
    assert CharacterImageGenerateRequest(project_id=42, prompt="x", num_images=2).num_images == 2


def test_image_dimensions_are_bounded():
    with pytest.raises(ValueError):
        CharacterImageGenerateRequest(project_id=42, prompt="x", width=100_000)
    with pytest.raises(ValueError):
        CharacterImageGenerateRequest(project_id=42, prompt="x", height=1)


def test_num_frames_is_bounded():
    """帧数决定抽帧与逐帧抠图的工作量。"""
    with pytest.raises(ValueError):
        CharacterActionGenerateRequest(project_id=42, character_id=1, action_type="walk", num_frames=100_000)
    with pytest.raises(ValueError):
        CharacterActionGenerateRequest(project_id=42, character_id=1, action_type="walk", num_frames=0)
    ok = CharacterActionGenerateRequest(project_id=42, character_id=1, action_type="walk", num_frames=16)
    assert ok.num_frames == 16


def test_custom_action_requires_a_non_empty_prompt():
    for prompt in (None, "", "   "):
        with pytest.raises(ValueError):
            CharacterActionGenerateRequest(
                project_id=42,
                character_id=1,
                action_type="custom",
                custom_prompt=prompt,
            )
    request = CharacterActionGenerateRequest(
        project_id=42,
        character_id=1,
        action_type="custom",
        custom_prompt="  wave hello  ",
    )
    assert request.custom_prompt == "wave hello"


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
