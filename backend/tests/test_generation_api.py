"""生成任务 HTTP 边界回归测试。"""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from windup_app.bootstrap.app import create_app
from windup_app.server.generation import task_repo
from windup_app.server.generation.model import (
    ActionType,
    CharacterActionInput,
    GenerationTaskRecord,
)
from windup_app.server.generation.service import AiGenerationService
from windup_framework.db import Base, get_session


class _ImmediateThread:
    """让测试中的后台任务立即运行，稳定复现提交与执行的先后顺序。"""

    def __init__(self, *, target, args, daemon):
        self._target = target
        self._args = args

    def start(self):
        self._target(*self._args)


def _action_payload():
    return {
        "user_id": 1,
        "project_id": 1,
        "character_id": 1,
        "action_type": "walk",
        "reference_image_urls": ["https://cdn.example.com/master.png"],
        "num_frames": 2,
    }


def _image_payload():
    return {
        "user_id": 1,
        "project_id": None,
        "prompt": "像素角色",
        "width": 64,
        "height": 64,
        "num_images": 1,
    }


def test_action_request_defaults_to_32_frames(client, monkeypatch):
    """调用方省略帧数时，HTTP 边界必须创建一项 32 帧动作任务。"""
    captured_inputs = []

    class _CaptureOnlyThread:
        def __init__(self, *, target, args, daemon):
            captured_inputs.append(args[1])

        def start(self):
            return None

    monkeypatch.setattr(
        "windup_app.web.api.generation.threading.Thread",
        _CaptureOnlyThread,
    )
    payload = _action_payload()
    payload.pop("num_frames")

    response = client.post("/generation/action", json=payload)

    assert response.status_code == 200
    assert response.json()["data"]["input_payload"]["num_frames"] == 32
    assert captured_inputs[0].num_frames == 32


def test_action_task_is_committed_before_background_execution(
    tmp_path,
    monkeypatch,
):
    """后台执行器必须能读到刚提交的任务并写入终态。"""
    engine = create_engine(f"sqlite:///{tmp_path / 'generation.db'}")
    Base.metadata.create_all(engine)
    session_local = sessionmaker(bind=engine, expire_on_commit=False)

    def override_get_session():
        with session_local() as session:
            try:
                yield session
                session.commit()
            except Exception:
                session.rollback()
                raise

    app = create_app()
    app.dependency_overrides[get_session] = override_get_session

    def complete_task(task_id, _input, _project_id):
        with session_local() as session:
            task_repo.update_result(
                session,
                task_id,
                "character_action",
                {
                    "type": "character_action",
                    "action_type": "walk",
                    "frames": [
                        {
                            "index": 0,
                            "image_url": "https://cdn.example.com/frame.png",
                            "duration_ms": 100,
                        }
                    ],
                },
            )
            session.commit()

    app.state.run_action_task = complete_task
    monkeypatch.setattr(
        "windup_app.web.api.generation.threading.Thread",
        _ImmediateThread,
    )

    with TestClient(app) as client:
        submitted = client.post("/generation/action", json=_action_payload()).json()[
            "data"
        ]
        task = client.get(
            f"/generation/tasks/{submitted['id']}",
            params={"project_id": 1},
        ).json()["data"]

    assert task["status"] == "completed"
    assert task["result"]["frames"][0]["image_url"].endswith("frame.png")
    engine.dispose()


def test_image_task_is_committed_before_background_execution(tmp_path, monkeypatch):
    """Quick Start 的首段图片任务也必须在后台执行前完成提交。"""
    engine = create_engine(f"sqlite:///{tmp_path / 'image-generation.db'}")
    Base.metadata.create_all(engine)
    session_local = sessionmaker(bind=engine, expire_on_commit=False)

    def override_get_session():
        with session_local() as session:
            try:
                yield session
                session.commit()
            except Exception:
                session.rollback()
                raise

    app = create_app()
    app.dependency_overrides[get_session] = override_get_session

    def complete_task(task_id, _input, _project_id):
        with session_local() as session:
            task_repo.update_result(
                session,
                task_id,
                "character_image",
                {
                    "type": "character_image",
                    "image_urls": ["https://cdn.example.com/character.png"],
                },
            )
            session.commit()

    app.state.run_image_task = complete_task
    monkeypatch.setattr(
        "windup_app.web.api.generation.threading.Thread",
        _ImmediateThread,
    )

    with TestClient(app) as client:
        submitted = client.post("/generation/image", json=_image_payload()).json()[
            "data"
        ]
        task = client.get(
            f"/generation/tasks/{submitted['id']}",
            params={"project_id": 1},
        ).json()["data"]

    assert task["status"] == "completed"
    assert task["result"]["image_urls"] == ["https://cdn.example.com/character.png"]
    engine.dispose()


def test_completed_task_stream_emits_terminal_snapshot(client, engine):
    """晚于任务完成建立 SSE 连接时，也必须立刻收到可恢复的终态快照。"""
    session_local = sessionmaker(bind=engine, expire_on_commit=False)
    action_input = CharacterActionInput(
        character_id=1,
        action_type=ActionType.WALK,
        reference_image_urls=["https://cdn.example.com/master.png"],
        num_frames=1,
    )
    with session_local() as session:
        task = AiGenerationService().generate_character_action(
            session,
            user_id=1,
            project_id=1,
            input=action_input,
        )
        session.commit()
        task_repo.update_result(
            session,
            task.id,
            "character_action",
            {
                "type": "character_action",
                "action_type": "walk",
                "frames": [
                    {
                        "index": 0,
                        "image_url": "https://cdn.example.com/frame.png",
                        "duration_ms": 100,
                    }
                ],
            },
        )
        session.commit()
        task_id = task.id

    with client.stream(
        "GET",
        f"/generation/tasks/{task_id}/stream",
        params={"project_id": 1},
    ) as response:
        body = "".join(response.iter_text())

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")
    event_lines = [line for line in body.splitlines() if line.startswith("data: ")]
    assert len(event_lines) == 1
    payload = json.loads(event_lines[0].removeprefix("data: "))
    assert payload["task_id"] == task_id
    assert payload["task_type"] == "character_action"
    assert payload["status"] == "completed"
    assert payload["result"]["frames"][0]["image_url"].endswith("frame.png")


def test_stale_incomplete_task_becomes_retryable_failure(client, engine):
    """后台进程丢失的旧任务不能让 Quick Start 永久停在生成中。"""
    session_local = sessionmaker(bind=engine, expire_on_commit=False)
    with session_local() as session:
        task = AiGenerationService().generate_character_action(
            session,
            user_id=1,
            project_id=1,
            input=CharacterActionInput(
                character_id=1,
                action_type=ActionType.WALK,
                reference_image_urls=["https://cdn.example.com/master.png"],
            ),
        )
        session.commit()
        record = session.get(GenerationTaskRecord, task.id)
        record.update_at = datetime.now(timezone.utc) - timedelta(minutes=16)
        session.commit()
        task_id = task.id

    response = client.get(
        f"/generation/tasks/{task_id}",
        params={"project_id": 1},
    ).json()["data"]

    assert response["status"] == "failed"
    assert "请重试" in response["error_message"]
