"""Executor 经 Gateway 装配,失败时仍绑定 task_id 供日志/trace,界面文案走脱敏出口。"""
from __future__ import annotations

import uuid

import pytest

from windup_framework.config.provider import AIProviderSettings
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from windup_framework.db.base import Base
from windup_framework.gateway.context import current_call_context
from windup_app.server.orchestrator.executor import (
    ActionTaskExecutor,
    ImageTaskExecutor,
    _resolve_video_model,
)
from windup_app.server.orchestrator.model import (
    ActionType,
    CharacterActionInput,
    CharacterImageInput,
    TaskStatus,
)
from windup_app.server.orchestrator.service import AiGenerationService
from windup_app.server.project.model import Project  # noqa: F401 — 注册表
from windup_app.server.quota.model import CreditAccount, CreditTransaction  # noqa: F401 — 注册表

from conftest import seed_credit_account


@pytest.fixture
def session_factory():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine)
    with factory() as session:
        seed_credit_account(session, 1)
        session.commit()
    return factory


def test_none_video_model_means_deploy_default():
    assert _resolve_video_model(None) is None


def test_unknown_model_error_lists_chain_members():
    with pytest.raises(ValueError) as e:
        _resolve_video_model("sora-2")
    msg = str(e.value)
    assert "sora-2" in msg
    # 从配置推而不是写死型号名:这条断言的是"报错要带上可选值",不是"默认型号叫什么"。
    # 写死的话,每换一次默认型号就要改一次测试,而它要保护的行为一个字没变。
    assert AIProviderSettings().video_model in msg, "报错要带上链上型号,否则调用方无从改"


def test_action_task_failure_includes_request_id(session_factory):
    seen: dict[str, str | None] = {}

    class _BoomGen:
        def generate(self, *args, **kwargs):
            ctx = current_call_context()
            seen["request_id"] = ctx.request_id
            seen["task_id"] = ctx.task_id
            seen["start_from_model"] = ctx.start_from_model
            raise RuntimeError("gateway boom")

    service = AiGenerationService()
    executor = ActionTaskExecutor(
        generator=_BoomGen(),
        fetch_master=lambda _input: b"png",
        session_factory=session_factory,
    )
    action_input = CharacterActionInput(
        character_id=1, action_type=ActionType.WALK, num_frames=4,
    )
    with session_factory() as s:
        task = service.generate_character_action(s, user_id=1, input=action_input)
        s.commit()
        task_id = task.id

    executor.run_action_task(task_id, action_input)

    with session_factory() as s:
        done = service.get_task(s, project_id=1, task_id=task_id)
    assert done.status is TaskStatus.FAILED
    assert done.error_message
    assert "request_id" not in (done.error_message or "")
    assert seen["request_id"] is not None
    uuid.UUID(str(seen["request_id"]))
    assert seen["task_id"] == str(task_id)
    assert seen["start_from_model"] is None


def test_action_task_binds_start_from_model(session_factory):
    seen: dict[str, str | None] = {}

    class _BoomGen:
        def generate(self, *args, **kwargs):
            seen["start_from_model"] = current_call_context().start_from_model
            raise RuntimeError("boom")

    service = AiGenerationService()
    executor = ActionTaskExecutor(
        generator=_BoomGen(),
        fetch_master=lambda _input: b"png",
        session_factory=session_factory,
    )
    action_input = CharacterActionInput(
        character_id=1, action_type=ActionType.WALK, num_frames=4,
        video_model=AIProviderSettings().video_model,
    )
    with session_factory() as s:
        task = service.generate_character_action(s, user_id=1, input=action_input)
        s.commit()
        task_id = task.id

    executor.run_action_task(task_id, action_input)

    with session_factory() as s:
        done = service.get_task(s, project_id=1, task_id=task_id)
    assert done.status is TaskStatus.FAILED
    assert seen["start_from_model"] == AIProviderSettings().video_model
    assert "request_id" not in (done.error_message or "")


def test_image_task_failure_includes_request_id(session_factory):
    seen: dict[str, str | None] = {}

    class _BoomImage:
        def gen_image(self, prompt, refs):
            seen["request_id"] = current_call_context().request_id
            seen["task_id"] = current_call_context().task_id
            raise RuntimeError("image boom")

    service = AiGenerationService()
    executor = ImageTaskExecutor(
        image=_BoomImage(),
        session_factory=session_factory,
    )
    image_input = CharacterImageInput(prompt="knight")
    with session_factory() as s:
        task = service.generate_character_image(s, user_id=1, input=image_input)
        s.commit()
        task_id = task.id

    executor.run_image_task(task_id, image_input)

    with session_factory() as s:
        done = service.get_task(s, project_id=1, task_id=task_id)
    assert done.status is TaskStatus.FAILED
    assert done.error_message
    assert "request_id" not in (done.error_message or "")
    assert seen["request_id"] is not None
    uuid.UUID(str(seen["request_id"]))
    assert seen["task_id"] == str(task_id)


def test_image_task_uses_distinct_request_ids_for_each_image(session_factory):
    import io

    from PIL import Image

    buf = io.BytesIO()
    Image.new("RGBA", (64, 64), (0, 0, 0, 0)).save(buf, format="PNG")
    png = buf.getvalue()
    seen_ids: list[str | None] = []

    class _CountingImage:
        def gen_image(self, prompt, refs):
            seen_ids.append(current_call_context().request_id)
            return png

    class _FakeMatte:
        def cutout(self, img):
            return img

    service = AiGenerationService()
    executor = ImageTaskExecutor(
        image=_CountingImage(),
        matte=_FakeMatte(),
        upload=lambda _png: "https://cdn.example.com/a.png",
        session_factory=session_factory,
    )
    image_input = CharacterImageInput(prompt="knight", num_images=3)
    with session_factory() as s:
        task = service.generate_character_image(s, user_id=1, input=image_input)
        s.commit()
        task_id = task.id

    executor.run_image_task(task_id, image_input)

    assert len(seen_ids) == 3
    assert len(set(seen_ids)) == 3
    for rid in seen_ids:
        uuid.UUID(str(rid))
