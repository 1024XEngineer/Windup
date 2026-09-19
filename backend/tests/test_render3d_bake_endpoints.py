"""浏览器出帧的四个端点:取参数 / 交帧 / 报交齐 / 报失败(#714)。

从 HTTP 入口发起,不直接调 service —— 加在编排层的字段没贯通到端点是这条线上反复出现
的缺陷形态(直接构造对象的单测会全绿)。

锁的是**归属与对账**:帧是交付产物,谁都能往里塞就等于谁都能改别人的交付;而"交齐了"
必须由服务端点数,不能信前端的说法。
"""

from __future__ import annotations

import io

import pytest
from PIL import Image
from sqlalchemy.orm import sessionmaker

from windup_app.server.orchestrator import client_bake
from windup_app.server.orchestrator.client_bake import ClientBakeSpec
from windup_app.server.orchestrator.model import GenerationTaskRecord, GenerationType, TaskStatus
from windup_app.server.project.model import Project

TASK_ID = 41
SPEC = ClientBakeSpec(
    model_url="https://cdn.test/media/model-3d/rigged.glb",
    clip="walk",
    direction="e",
    camera_yaw=0.0,
    frames=2,
    width=1536,
    height=2560,
    material="cel",
    min_coverage=0.005,
)


def _png() -> bytes:
    image = Image.new("RGBA", (8, 8), (200, 60, 60, 255))
    buffer = io.BytesIO()
    image.save(buffer, "PNG")
    return buffer.getvalue()


class _MemStore:
    """把 client_bake 的 Redis 面换成进程内字典;延迟队列只记有没有被投过。"""

    def __init__(self) -> None:
        self.specs: dict[int, ClientBakeSpec] = {}
        self.frames: dict[int, dict[int, bytes]] = {}
        self.resumed: list[tuple[int, str]] = []


@pytest.fixture()
def store(monkeypatch):
    mem = _MemStore()

    def load_spec(task_id):
        spec = mem.specs.get(task_id)
        return (spec, 0.0) if spec else None

    def put_frame(task_id, index, png):
        spec = mem.specs.get(task_id)
        if spec is None:
            raise client_bake.ClientBakeError(f"任务 {task_id} 没有待出帧的登记")
        if not 0 <= index < spec.frames:
            raise client_bake.ClientBakeError(f"帧下标 {index} 不在 0..{spec.frames - 1}")
        if not png.startswith(b"\x89PNG\r\n\x1a\n"):
            raise client_bake.ClientBakeError(f"第 {index} 帧不是 PNG")
        mem.frames.setdefault(task_id, {})[index] = png
        return len(mem.frames[task_id])

    def collect_frames(task_id, expected):
        got = mem.frames.get(task_id, {})
        for i in range(expected):
            if i not in got:
                raise client_bake.ClientBakeError(f"缺第 {i} 帧(已收 {len(got)}/{expected})")
        return [got[i] for i in range(expected)]

    def public_view(task_id):
        spec = mem.specs.get(task_id)
        if spec is None:
            return None
        view = spec.to_payload()
        view["task_id"] = task_id
        view["deadline_at"] = 0.0
        view["received"] = len(mem.frames.get(task_id, {}))
        return view

    monkeypatch.setattr(client_bake, "load_spec", load_spec)
    monkeypatch.setattr(client_bake, "put_frame", put_frame)
    monkeypatch.setattr(client_bake, "collect_frames", collect_frames)
    monkeypatch.setattr(client_bake, "public_view", public_view)
    monkeypatch.setattr(
        client_bake,
        "schedule_resume",
        lambda task_id, reason=client_bake.REASON_FRAMES, detail="": mem.resumed.append(
            (task_id, reason)
        ),
    )
    return mem


@pytest.fixture()
def api(auth_client, engine, store):
    """一个属于 user 1 的 RUNNING 动作任务,外加一条属于别人的同类任务。"""
    session = sessionmaker(bind=engine)()
    session.add(Project(id=1, user_id=1, project_name="p",
                        directional_movement=1, sprite_width=64, sprite_height=64))
    session.flush()
    for task_id, user_id in ((TASK_ID, 1), (TASK_ID + 1, 2)):
        session.add(GenerationTaskRecord(
            id=task_id, user_id=user_id, project_id=1,
            task_type=GenerationType.CHARACTER_ACTION.value,
            status=TaskStatus.RUNNING.value, input_payload={},
        ))
    session.commit()
    session.close()
    store.specs[TASK_ID] = SPEC
    store.specs[TASK_ID + 1] = SPEC
    return auth_client


def _data(response) -> dict:
    body = response.json()
    assert body["code"] == 200, body
    return body["data"]


def _refused(response) -> dict:
    """断言被拒。**要具体码,不能只断言"不是成功"** —— 那样 500 也算过,
    于是"闸拦住了"与"代码崩了"在用例里长得一模一样。"""
    body = response.json()
    assert body["code"] in (400, 404), body
    return body


def test_get_bake_job_returns_the_render_plan(api):
    data = _data(api.get(f"/render3d/bake/{TASK_ID}"))
    assert data["model_url"] == SPEC.model_url
    assert (data["clip"], data["direction"], data["frames"]) == ("walk", "e", 2)
    assert data["width"] == 1536 and data["height"] == 2560
    assert data["min_coverage"] == 0.005


def test_get_bake_job_without_registration_is_404(api, store):
    store.specs.pop(TASK_ID)
    _refused(api.get(f"/render3d/bake/{TASK_ID}"))


def test_another_users_task_is_not_reachable(api):
    """帧是交付产物 —— 归属校验不做,谁都能改别人的交付而没有任何一处会红。"""
    _refused(api.get(f"/render3d/bake/{TASK_ID + 1}"))
    _refused(
        api.post(
            f"/render3d/bake/{TASK_ID + 1}/frames/0",
            files={"file": ("f00.png", _png(), "image/png")},
        )
    )


def test_put_frames_then_complete_hands_back_to_the_worker(api, store):
    for index in range(2):
        data = _data(
            api.post(
                f"/render3d/bake/{TASK_ID}/frames/{index}",
                files={"file": (f"f{index:02d}.png", _png(), "image/png")},
            )
        )
        assert data["received"] == index + 1
    _data(
        api.post(
            f"/render3d/bake/{TASK_ID}/complete",
            json={"clip": "walk", "sample_times": [0.0, 0.5]},
        )
    )
    assert store.resumed == [(TASK_ID, client_bake.REASON_FRAMES)]


def test_complete_with_missing_frames_is_refused(api, store):
    """不信前端说交齐了 —— 少一帧的序列在下游帧数、时长、成色全都自洽。"""
    api.post(
        f"/render3d/bake/{TASK_ID}/frames/0",
        files={"file": ("f00.png", _png(), "image/png")},
    )
    _refused(
        api.post(f"/render3d/bake/{TASK_ID}/complete", json={"clip": "walk", "sample_times": []})
    )
    assert store.resumed == [], "帧不齐却已经交回 worker 续跑"


def test_complete_with_a_different_clip_is_refused(api, store):
    """片段对不上等于渲的是另一个动作,而帧数与成色照样正常。"""
    for index in range(2):
        api.post(
            f"/render3d/bake/{TASK_ID}/frames/{index}",
            files={"file": (f"f{index:02d}.png", _png(), "image/png")},
        )
    _refused(
        api.post(f"/render3d/bake/{TASK_ID}/complete", json={"clip": "run", "sample_times": []})
    )
    assert store.resumed == []


def test_non_png_frame_is_refused(api):
    """空画布时 toDataURL 会给出没有 base64 段的串,切出来就是这种东西。"""
    _refused(
        api.post(
            f"/render3d/bake/{TASK_ID}/frames/0",
            files={"file": ("f00.png", b"data:,", "image/png")},
        )
    )


def test_fail_reports_client_side_failure(api, store):
    _data(api.post(f"/render3d/bake/{TASK_ID}/fail", json={"reason": "WebGL 上下文创建失败"}))
    assert store.resumed == [(TASK_ID, client_bake.REASON_CLIENT_FAILED)]
