"""四向 / 八向动作首帧执行器:该朝向立绘为唯一参考,锁方位后换姿态。"""

from __future__ import annotations

import io

import numpy as np
from PIL import Image

from windup_app.server.orchestrator.executor import ProjectConstraints
from windup_app.server.orchestrator.first_frame_executor import FirstFrameTaskExecutor
from windup_app.server.orchestrator.model import ActionType, CharacterFirstFrameInput
from windup_common.directions import ActionDirection

_BG = (200, 200, 200)


def _master(size: int = 64) -> bytes:
    arr = np.zeros((size, size, 4), "uint8")
    arr[:, :, :3] = _BG
    arr[:, :, 3] = 255
    arr[20:44, 20:38, :3] = (30, 60, 200)
    buf = io.BytesIO()
    Image.fromarray(arr, "RGBA").save(buf, "PNG")
    return buf.getvalue()


class _BackgroundMatte:
    def cutout(self, png: bytes) -> bytes:
        arr = np.asarray(Image.open(io.BytesIO(png)).convert("RGBA")).copy()
        bg = np.all(np.abs(arr[:, :, :3].astype(int) - np.array(_BG)) <= 8, axis=-1)
        arr[bg, 3] = 0
        buf = io.BytesIO()
        Image.fromarray(arr, "RGBA").save(buf, "PNG")
        return buf.getvalue()


def test_first_frame_keeps_attached_heading_and_skips_style_ref():
    master = _master()
    seen: dict[str, object] = {}

    class _RecordingGen:
        def gen_image(self, prompt, refs):
            seen["prompt"] = prompt
            seen["n_refs"] = len(refs)
            return master

    FirstFrameTaskExecutor(
        image=_RecordingGen(),
        matte=_BackgroundMatte(),
        upload=lambda _png: "https://cdn.example.com/result.png",
        fetch_ref=lambda _url: master,
    )._produce_first_frame(
        CharacterFirstFrameInput(
            character_id=7,
            reference_image_url="https://cdn.example.com/east.png",
            prompt="walk cycle first frame, left foot forward",
            width=64,
            height=64,
            num_images=1,
            direction=ActionDirection.EAST,
            action_type=ActionType.WALK,
        ),
        ProjectConstraints(
            directions=4,
            perspective=2,
            view="top-down view",
            sprite_w=64,
            sprite_h=64,
            sprite_sample_url="https://cdn.example.com/style.png",
        ),
    )

    prompt = str(seen["prompt"]).lower()
    assert "already facing the requested compass heading" in prompt
    assert "ninety-degree" in prompt
    assert "walk cycle first frame" in prompt
    assert "rotate the character, not the camera" not in prompt
    assert "front-view character master" not in prompt
    assert seen["n_refs"] == 1
