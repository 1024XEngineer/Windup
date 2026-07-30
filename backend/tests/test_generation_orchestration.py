"""生成任务编排端到端(离线):提交任务 → 后台调 ai_engine 出帧 → 上传 → 写回结果。

用内存 sqlite + 真实 GenerationTaskRecord ORM + 真实 AiGenerationService + 真实
CharacterGenerator(视频 provider / matte / 抽帧全部桩替,不联网、不碰对象存储)。
证明"任务 → ai_engine → 帧 → COMPLETED"这条链真能跑通。
"""
from __future__ import annotations

import io

import pytest
from PIL import Image
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from windup_framework.db.base import Base
from windup_app.server.project.model import Project  # 注册 windup_project 表(create_all 用)
from windup_app.server.generation.model import (
    ActionType,
    CharacterActionInput,
    CharacterActionOutput,
    TaskStatus,
)
from windup_app.server.generation.executor import ActionTaskExecutor
from windup_app.server.generation.service import AiGenerationService
from windup_ai_engine.impl import CharacterGenerator
from windup_ai_engine.strategy.concrete import VideoFrameStrategy
from windup_common.models import GenRoute


def _tiny_png(shift: int = 0) -> bytes:
    img = Image.new("RGBA", (64, 96), (0, 0, 0, 0))
    for y in range(20, 80):
        for x in range(24 + shift, 40 + shift):
            img.putpixel((x, y), (200, 60, 60, 255))
    buf = io.BytesIO()
    img.save(buf, "PNG")
    return buf.getvalue()


class _StubVideo:
    def i2v(self, first_frame, prompt, seconds=5, size="1280x720"):
        return b"fake-mp4"


class _StubMatte:
    def cutout(self, frame):
        return frame


@pytest.fixture
def session_factory():
    """共享的内存 sqlite(StaticPool 保证多 session 同库),建好任务表。"""
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine)


def _real_offline_generator(monkeypatch) -> CharacterGenerator:
    """真实 CharacterGenerator,但抽帧顶替成合成帧(不解码 mp4 / 不联网)。"""
    dense = [
        Image.open(io.BytesIO(_tiny_png(shift=i % 6))).convert("RGBA")
        for i in range(24)
    ]
    monkeypatch.setattr(
        "windup_ai_engine.strategy.concrete.extract_all_frames_bytes",
        lambda video, cap=150: dense,
    )
    return CharacterGenerator(
        {GenRoute.VIDEO_I2V: VideoFrameStrategy(_StubVideo(), _StubMatte())}
    )


def test_action_task_runs_end_to_end(session_factory, monkeypatch):
    uploaded: list[bytes] = []

    def _upload(png: bytes) -> str:
        uploaded.append(png)
        return f"https://cdn.example.com/frame-{len(uploaded)}.png"

    service = AiGenerationService()
    executor = ActionTaskExecutor(
        generator=_real_offline_generator(monkeypatch),
        upload=_upload,
        fetch_master=lambda _input: _tiny_png(),
        session_factory=session_factory,
    )
    action_input = CharacterActionInput(
        character_id=1, action_type=ActionType.WALK, num_frames=6,
    )

    # 1) 提交:建 PENDING 任务
    with session_factory() as s:
        task = service.generate_character_action(s, user_id=1, input=action_input)
        s.commit()
        task_id = task.id
    assert task.status is TaskStatus.PENDING

    # 2) 后台跑(自开 session)
    executor.run_action_task(task_id, action_input)

    # 3) 轮询:任务 COMPLETED,结果是含 URL 的帧序列
    with session_factory() as s:
        done = service.get_task(s, project_id=1, task_id=task_id)
    assert done is not None
    assert done.status is TaskStatus.COMPLETED
    assert isinstance(done.result, CharacterActionOutput)
    assert done.result.action_type == "walk"
    assert len(done.result.frames) >= 1
    assert uploaded, "应逐帧上传"
    for i, frame in enumerate(done.result.frames):
        assert frame.index == i
        assert frame.image_url.startswith("https://")
        assert frame.duration_ms is not None


class _SpyGenerator:
    """记录传入的 facing,验证项目约束确实喂进了 ai_engine。"""

    def __init__(self) -> None:
        self.seen_facing: str | None = None

    def generate(self, card, action, master, progress):
        from windup_ai_engine.ports import GeneratedAction

        self.seen_facing = action.facing
        return GeneratedAction(frames=[_tiny_png()], durations=[100], fps=10)


def test_project_perspective_constrains_facing(session_factory):
    # perspective=2 → front(见 executor._PERSPECTIVE_TO_FACING)
    with session_factory() as s:
        proj = Project(
            user_id=1, project_name="p", character_perspective=2,
            directional_movement=1, sprite_width=64, sprite_height=64,
        )
        s.add(proj)
        s.commit()
        project_id = proj.id

    spy = _SpyGenerator()
    executor = ActionTaskExecutor(
        generator=spy,
        upload=lambda _png: "https://cdn.example.com/f.png",
        fetch_master=lambda _input: _tiny_png(),
        session_factory=session_factory,
    )
    action_input = CharacterActionInput(
        character_id=1, action_type=ActionType.WALK, num_frames=2,
    )
    with session_factory() as s:
        task = AiGenerationService().generate_character_action(s, user_id=1, input=action_input)
        s.commit()
        task_id = task.id

    executor.run_action_task(task_id, action_input, project_id)  # 带项目约束

    assert spy.seen_facing == "front", "项目 perspective 应约束生成朝向"


def test_action_task_marks_failed_on_error(session_factory):
    def _boom(_input):
        raise RuntimeError("母版下载失败")

    service = AiGenerationService()
    executor = ActionTaskExecutor(
        generator=None,                 # 不会用到:取母版先炸
        fetch_master=_boom,
        session_factory=session_factory,
    )
    action_input = CharacterActionInput(
        character_id=1, action_type=ActionType.WALK, num_frames=4,
    )
    with session_factory() as s:
        task = service.generate_character_action(s, user_id=1, input=action_input)
        s.commit()
        task_id = task.id

    executor.run_action_task(task_id, action_input)  # 不抛,兜底为 FAILED

    with session_factory() as s:
        done = service.get_task(s, project_id=1, task_id=task_id)
    assert done.status is TaskStatus.FAILED
    assert "母版下载失败" in (done.error_message or "")
