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
from windup_app.server.quota.model import CreditAccount
from windup_app.server.orchestrator.model import (
    ActionType,
    CharacterActionInput,
    CharacterActionOutput,
    TaskStatus,
)
from windup_app.server.orchestrator.executor import ActionTaskExecutor
from windup_app.server.orchestrator.service import AiGenerationService
from windup_ai_engine.impl import CharacterGenerator
from windup_ai_engine.strategy.concrete import VideoFrameStrategy
from windup_common.models import GenRoute
from windup_framework.config.quota import settings as quota_settings


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
    factory = sessionmaker(bind=engine)
    with factory() as session:
        session.add(CreditAccount(
            user_id=1,
            balance=quota_settings.register_gift_amount,
            frozen=0,
            total_earned=quota_settings.register_gift_amount,
            total_spent=0,
        ))
        session.commit()
    return factory


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


def _png_of(w: int, h: int) -> bytes:
    """指定尺寸的一张带主体的 PNG。"""
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    img.paste((200, 60, 60, 255), (w // 4, h // 4, w // 2, h // 2))
    buf = io.BytesIO()
    img.save(buf, "PNG")
    return buf.getvalue()


class _SpyGenerator:
    """记录传入的 facing / canvas,验证项目约束确实喂进了 ai_engine。

    ``canvas`` 是必须接的:交付尺寸现在由引擎按项目 sprite 尺寸出帧负责,编排层
    不再拿到帧之后自己缩 —— 那一步用 thumbnail 补边,只缩不放,会把引擎对齐好的
    脚线挪走。本 spy 照真实引擎的约定按 canvas 出帧。

    ``honour_canvas=False`` 用来模拟"引擎没按尺寸出帧",验证编排层会报错而不是
    静默缩放补救。
    """

    def __init__(self, honour_canvas: bool = True) -> None:
        self.seen_facing: str | None = None
        self.seen_canvas: tuple[int, int] | None = None
        self.seen_action = None
        self._honour = honour_canvas

    def generate(self, card, action, master, progress, canvas=None):
        from windup_ai_engine.ports import GeneratedAction

        self.seen_facing = action.facing
        self.seen_canvas = canvas
        self.seen_action = action
        size = canvas if (canvas and self._honour) else (256, 256)
        # 不传 fps:GeneratedAction 早已删掉该字段(播放时序的唯一真相源是 durations)。
        # 这个 spy 之前一直在传,构造直接 TypeError、任务被判 FAILED —— 而当时的用例
        # 只断言 seen_facing(在构造之前就赋了值),于是**用例绿着、任务其实是失败的**。
        from windup_ai_engine.ports import ActionQuality

        return GeneratedAction(
            frames=[_png_of(*size)],
            durations=[100],
            quality=ActionQuality(motion_scale=1.0, dead_frames=[], loop_seam=None),
        )


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


def test_custom_action_reuses_oneshot_route_and_preserves_prompt(session_factory):
    spy = _SpyGenerator()
    executor = ActionTaskExecutor(
        generator=spy,
        upload=lambda _png: "https://cdn.example.com/f.png",
        fetch_master=lambda _input: _tiny_png(),
        session_factory=session_factory,
    )
    action_input = CharacterActionInput(
        character_id=1,
        action_type=ActionType.CUSTOM,
        custom_prompt="wave hello with the right hand",
        num_frames=2,
    )
    with session_factory() as s:
        task = AiGenerationService().generate_character_action(s, user_id=1, input=action_input)
        s.commit()
        task_id = task.id

    executor.run_action_task(task_id, action_input)

    assert spy.seen_action.action.value == "custom"
    assert spy.seen_action.custom_action == "wave hello with the right hand"
    # loop 没给 → 兜成一次性(失败代价不对称,见 executor 里的说明),而不是抛错。
    assert spy.seen_action.cyclic is False


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


# ── 交付尺寸传给引擎(2026-08-11 挣得)──────────────────────────────────────────
#
# 这里以前是拿到 256 的帧再 _fit_to 到项目 sprite 尺寸。那步用 Image.thumbnail 补边,
# 而 thumbnail **只缩不放**:项目要 512 时帧根本不会被放大,只是原尺寸居中贴进 512
# 画布,于是引擎刚对齐好的脚线 0.92 被挪到 0.709(实测),角色不站在地上。
# 现在尺寸交给引擎(canvas),编排层只核对、不缩放。


def _run_with_project(session_factory, spy, sprite=(64, 64)):
    """建一个指定 sprite 尺寸的项目,跑一次动作任务,返回 (task_id, project_id)。"""
    with session_factory() as s:
        proj = Project(
            user_id=1, project_name="p", character_perspective=1,
            directional_movement=1, sprite_width=sprite[0], sprite_height=sprite[1],
        )
        s.add(proj)
        s.commit()
        project_id = proj.id

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
        task = AiGenerationService().generate_character_action(
            s, user_id=1, input=action_input
        )
        s.commit()
        task_id = task.id
    executor.run_action_task(task_id, action_input, project_id)
    return task_id, project_id


def test_project_sprite_size_is_passed_to_the_engine(session_factory):
    """项目 sprite 尺寸必须作为 canvas 传进引擎 —— 而不是拿到帧再缩。"""
    spy = _SpyGenerator()
    _run_with_project(session_factory, spy, sprite=(512, 512))
    assert spy.seen_canvas == (512, 512), "引擎应当收到项目 sprite 尺寸"


def test_non_square_project_sprite_size_is_passed_through(session_factory):
    """非方形项目尺寸也要原样传下去,不能只传一个边长。"""
    spy = _SpyGenerator()
    _run_with_project(session_factory, spy, sprite=(384, 512))
    assert spy.seen_canvas == (384, 512)


def test_engine_frame_of_wrong_size_fails_instead_of_being_rescaled(session_factory):
    """引擎没按尺寸出帧 → 任务失败,**不做静默缩放补救**。

    以前这里会 _fit_to 补救,把"引擎没按尺寸出帧"抹平,代价是脚线对齐被破坏 ——
    正是本仓最忌讳的"看起来成功的错产物"。
    """
    spy = _SpyGenerator(honour_canvas=False)      # 恒出 256,无视 canvas
    task_id, _ = _run_with_project(session_factory, spy, sprite=(512, 512))
    with session_factory() as s:
        done = AiGenerationService().get_task(s, project_id=1, task_id=task_id)
    assert done.status is TaskStatus.FAILED, "尺寸对不上必须失败,不能悄悄缩放交付"
    assert "512" in (done.error_message or ""), "报错要说清期望尺寸"
