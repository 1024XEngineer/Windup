"""任务要能被归因到具体版本 —— 否则线上数据说不了话。

背景：2026-08-21 排查产物质量退化，只能按时间戳分组，而同一天里 08:48 的 walk 正常、
10:25 的 walk 孔洞峰值 19%、15:54 的又正常，时间戳分不开版本。
"""

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from windup_app.server.orchestrator import task_repo
from windup_app.server.orchestrator.model import GenerationType, TaskStatus
from windup_framework.db.base import Base
from windup_framework.mq.model import MqMessage  # noqa: F401 — register metadata
from windup_framework.runtime_version import code_version, runtime_snapshot


@pytest.fixture
def session_factory():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine)


def _mk(session, **kw):
    return task_repo.create_task(
        session, user_id=1, project_id=None,
        task_type=GenerationType.CHARACTER_ACTION, input_payload={"action_type": "walk"}, **kw,
    )


def test_version_is_written_at_creation_not_on_success(session_factory):
    """写在建任务那一步 —— 失败的任务同样要能归因，而失败时没有 result 可挂。"""
    with session_factory() as s:
        task = _mk(s)
        task_repo.update_status(s, task.id, TaskStatus.FAILED, error_message="上游挂了")
        s.commit()
        got = task_repo.get_task(s, task.id)
    assert got.status is TaskStatus.FAILED
    assert got.runtime and got.runtime.get("commit"), "失败任务没有版本 = 归因链断在最需要它的地方"


def test_version_does_not_depend_on_a_hand_maintained_constant():
    """`PROMPT_VERSION` 恒为 v1、期间提示词改过两次都没人加 —— 靠人记得改的版本号必然漂移。"""
    v = code_version()
    assert set(v) == {"commit", "source"}
    assert v["source"] in ("build", "git", "unknown")
    if v["source"] != "unknown":
        assert len(v["commit"]) == 12, "commit 应为 12 位短哈希"


def test_merge_keeps_the_commit_written_at_creation(session_factory):
    """executor 后来并进型号时不能把建任务时写的 commit 冲掉。"""
    with session_factory() as s:
        task = _mk(s)
        before = task_repo.get_task(s, task.id).runtime["commit"]
        task_repo.merge_runtime(s, task.id, {"video_model": "kling-v2-5-turbo", "route": "video_i2v"})
        s.commit()
        got = task_repo.get_task(s, task.id).runtime
    assert got["commit"] == before
    assert got["video_model"] == "kling-v2-5-turbo"
    assert got["route"] == "video_i2v"


def test_empty_values_are_not_recorded(session_factory):
    """空值不写：`{"video_model": None}` 会让读账的人以为量过了。"""
    with session_factory() as s:
        task = _mk(s)
        task_repo.merge_runtime(s, task.id, {"video_model": None, "route": ""})
        s.commit()
        got = task_repo.get_task(s, task.id).runtime
    assert "video_model" not in got and "route" not in got


def test_snapshot_carries_extra_only_when_present():
    snap = runtime_snapshot(image_model="gemini-2.5-flash-image", video_model=None)
    assert snap["image_model"] == "gemini-2.5-flash-image"
    assert "video_model" not in snap
