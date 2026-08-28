"""四向 / 八向动作首帧编排。

以该朝向已确认立绘为唯一参考图,锁住方位后换成动作起手姿态。
不经过 ``ImageTaskExecutor._produce_image``。

web **不得 import 本模块**(与 ``executor`` 同门禁:会牵出 ai_engine)。
"""

from __future__ import annotations

import io
import logging
import threading
from collections.abc import Callable
from typing import TYPE_CHECKING

from PIL import Image
from sqlalchemy.orm import Session

from windup_ai_engine.prompt import build_oriented_first_frame_prompt, view_for_perspective
from windup_ai_engine.slicing.quality import subject_blobs
from windup_framework.gateway import bind_call_context, fresh_gateway_request

from windup_app.server.orchestrator import generation_io, task_repo
from windup_app.server.orchestrator._failure import user_message
from windup_app.server.orchestrator._fetch import fetch_own_media
from windup_app.server.orchestrator.executor import (
    ProjectConstraints,
    _close_failed,
    _fit_to,
    _load_constraints,
    _settle_credit,
)
from windup_app.server.orchestrator.model import (
    CharacterFirstFrameInput,
    GenerationType,
    TaskStatus,
)

if TYPE_CHECKING:
    from windup_framework.providers import MatteProvider

logger = logging.getLogger("windup.generation.first_frame")

_RESULT = GenerationType.CHARACTER_FIRST_FRAME.value


class FirstFrameTaskExecutor:
    """跑锁定朝向的动作首帧:该朝向立绘 + 方位锁提示词 → 图生图 → 上传。"""

    def __init__(
        self,
        *,
        image=None,
        matte: MatteProvider | None = None,
        upload: Callable[[bytes], str] | None = None,
        fetch_ref: Callable[[str], bytes] | None = None,
        session_factory: Callable[[], Session] | None = None,
    ) -> None:
        self._image = image
        self._matte = matte
        self._upload = upload
        self._fetch_ref = fetch_ref
        self._session_factory = session_factory
        self._assembly_lock = threading.Lock()

    def run_first_frame_task(
        self,
        task_id: int,
        input: CharacterFirstFrameInput,
        project_id: int | None = None,
        *,
        session: Session | None = None,
    ) -> None:
        reset = None
        try:

            def _mark_running(s: Session) -> ProjectConstraints:
                task_repo.update_status(s, task_id, TaskStatus.RUNNING)
                return _load_constraints(s, project_id)

            cons = generation_io.using_session(session, self._make_session, _mark_running)
            reset = bind_call_context(task_id=str(task_id))
            urls, quality = self._produce_first_frame(input, cons)

            def _complete(s: Session) -> None:
                task_repo.update_result(
                    s,
                    task_id,
                    _RESULT,
                    {
                        "type": _RESULT,
                        "direction": input.direction.value,
                        "image_urls": urls,
                        "quality": quality,
                    },
                )
                _settle_credit(s, task_id, success=True)

            generation_io.using_session(session, self._make_session, _complete)
        except Exception as exc:  # noqa: BLE001 —— 兜底
            logger.exception("动作首帧任务 %s 失败", task_id)
            if session is not None:
                session.rollback()
            error_message = user_message(exc)

            def _fail(s: Session) -> None:
                _close_failed(s, task_id, error_message)

            generation_io.using_session(session, self._make_session, _fail)
        finally:
            if reset is not None:
                reset()

    def _produce_first_frame(
        self, input: CharacterFirstFrameInput, cons: ProjectConstraints
    ) -> tuple[list[str], dict]:
        fetch = self._fetch_ref or self._download
        heading_png = fetch(input.reference_image_url)
        prompt = build_oriented_first_frame_prompt(
            input.direction,
            view=view_for_perspective(cons.perspective),
            action_prompt=input.prompt,
        )
        image_gen = self._get_image()
        matte = self._get_matte()
        upload = self._upload or self._upload_image
        refs = [heading_png]
        n_images = max(1, input.num_images or 1)

        from windup_framework.gateway.registry import ModelRegistry, candidate_models
        from windup_framework.gateway.types import Scene

        spread = candidate_models(
            ModelRegistry.from_settings().chain(Scene.CHARACTER_IMAGE),
            n_images,
        )

        def _gen_one(i: int) -> bytes:
            reset_call = fresh_gateway_request(start_from_model=spread[i])
            try:
                return image_gen.gen_image(prompt, refs)
            finally:
                reset_call()

        raws = generation_io.io_map(_gen_one, range(n_images))
        cut: list[Image.Image] = []
        pngs: list[bytes] = []
        for img in raws:
            png = _fit_to(
                matte.cutout(img),
                input.width,
                input.height,
                smooth=cons.stylize != "pixel",
            )
            cut.append(Image.open(io.BytesIO(png)).convert("RGBA"))
            pngs.append(png)
        urls = generation_io.upload_frames(upload, pngs)
        return urls, {"subject_blobs": list(subject_blobs(cut))}

    def _get_image(self):
        if self._image is not None:
            return self._image
        with self._assembly_lock:
            if self._image is None:
                from windup_framework.gateway import build_image_gateway

                self._image = build_image_gateway()
            return self._image

    def _get_matte(self):
        if self._matte is not None:
            return self._matte
        with self._assembly_lock:
            if self._matte is None:
                from windup_framework.providers import get_matte_provider

                self._matte = get_matte_provider()
            return self._matte

    def _download(self, url: str) -> bytes:
        return fetch_own_media(url)

    def _upload_image(self, png: bytes) -> str:
        from windup_app.server.media.model import MediaCategory, MediaUploadInput
        from windup_app.server.media.service import service as media_service

        meta = MediaUploadInput(
            filename="first-frame.png",
            content_type="image/png",
            size=len(png),
            category=MediaCategory.ACTION_FRAME,
        )
        return media_service.upload(png, meta).url

    def _make_session(self) -> Session:
        if self._session_factory is not None:
            return self._session_factory()
        from windup_framework.db.session import SessionLocal

        return SessionLocal()


first_frame_executor = FirstFrameTaskExecutor()
run_first_frame_task = first_frame_executor.run_first_frame_task
