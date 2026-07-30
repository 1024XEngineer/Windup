"""动作生成后台编排(调 ai_engine)。

编排链:``mark RUNNING → 取母版 → ai_engine 出帧 → 逐帧上传对象存储 → 写回结果/COMPLETED``。
异常兜底为 FAILED,不抛。

**分层**:本模块调 ai_engine,故 web/worker **不得 import 本模块**(否则牵出 ai_engine,
违反"入口层不经 ai_engine 直连"门禁)。由 bootstrap(composition root)import + 注入
``app.state``,web 端从 ``request.app.state`` 运行期取回调度,不产生静态依赖。

依赖(generator / upload / 取母版 / session 工厂)全可注入,缺省用真实实现(懒加载,
避免 import-time 触发 AI 配置)。测试注入桩即可离线跑通,不联网、不碰对象存储。
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from typing import TYPE_CHECKING

import httpx
from sqlalchemy.orm import Session

from windup_common.models import ActionSpec, ActionType as EngineActionType, CharacterCard

from windup_app.server.generation import task_repo
from windup_app.server.generation.model import CharacterActionInput, TaskStatus

if TYPE_CHECKING:
    from windup_ai_engine.ports import CharacterGeneratorPort, ProgressPort

logger = logging.getLogger("windup.generation.executor")

_ACTION_RESULT = "character_action"  # task_repo._deserialize_result 按此标签反序列化

# Project.character_perspective(1-3)→ 提示词/母版朝向 facing(side/front)。
# 朝向必须与母版一致(#35),故生成前从项目约束取。1/2/3 语义待与作者确认,暂:1=侧视,余=正面。
_PERSPECTIVE_TO_FACING: dict[int, str] = {1: "side", 2: "front", 3: "front"}


class _LogProgress:
    """进度上报占位:MVP 无 SSE,记日志即可。"""

    def step(self, stage: str, i: int, total: int, note: str = "") -> None:
        logger.info("[gen] %s %s/%s %s", stage, i, total, note)


def _to_engine_action(t) -> EngineActionType:
    """generation.ActionType → 引擎 common.ActionType(按值映射)。

    walk/idle/attack 直通;custom 等引擎未覆盖的类型暂不支持视频路线。
    """
    try:
        return EngineActionType(t.value)
    except ValueError as e:
        raise ValueError(f"动作类型 {t.value!r} 暂不支持视频生成路线") from e


class ActionTaskExecutor:
    """把一个 PENDING 动作任务跑成 COMPLETED/FAILED。"""

    def __init__(
        self,
        *,
        generator: CharacterGeneratorPort | None = None,
        upload: Callable[[bytes], str] | None = None,
        fetch_master: Callable[[CharacterActionInput], bytes] | None = None,
        fetch_facing: Callable[[Session, int | None], str] | None = None,
        session_factory: Callable[[], Session] | None = None,
    ) -> None:
        self._generator = generator          # None → 懒加载真实装配
        self._upload = upload                # None → 真实对象存储上传
        self._fetch_master = fetch_master    # None → 下载 reference_image_urls[0]
        self._fetch_facing = fetch_facing    # None → 查 project 约束(character_perspective)
        self._session_factory = session_factory  # None → SessionLocal

    def run_action_task(
        self,
        task_id: int,
        input: CharacterActionInput,
        project_id: int | None = None,
        *,
        session: Session | None = None,
    ) -> None:
        """跑一个动作任务;异常兜底为 FAILED,不抛。

        先从 ``project`` 取约束(朝向)再调 ai_engine。``session`` 缺省时自开一个
        (后台场景);测试可传入自己的 session。
        """
        own = session is None
        session = session or self._make_session()
        try:
            task_repo.update_status(session, task_id, TaskStatus.RUNNING)
            if own:
                session.commit()

            facing = self._resolve_facing(session, project_id)   # 项目约束
            result = self._produce_action(input, facing)
            task_repo.update_result(session, task_id, _ACTION_RESULT, result)
            if own:
                session.commit()
        except Exception as exc:  # noqa: BLE001 —— 兜底任何生成/上传/网络异常
            logger.exception("动作任务 %s 失败", task_id)
            task_repo.update_status(
                session, task_id, TaskStatus.FAILED, error_message=str(exc),
            )
            if own:
                session.commit()
        finally:
            if own:
                session.close()

    # -- 内部 --------------------------------------------------------------

    def _resolve_facing(self, session: Session, project_id: int | None) -> str:
        """从 project 约束取朝向(character_perspective → facing);缺省侧视。"""
        if self._fetch_facing is not None:
            return self._fetch_facing(session, project_id)
        if project_id is None:
            return "side"
        from windup_app.server.project.service import SqlAlchemyProjectService

        project = SqlAlchemyProjectService().get_project(session, project_id)
        if project is None:
            return "side"
        return _PERSPECTIVE_TO_FACING.get(project.character_perspective, "side")

    def _produce_action(self, input: CharacterActionInput, facing: str) -> dict:
        """母版 → ai_engine 出帧 → 逐帧上传 → 组 character_action 结果 dict。"""
        master = (self._fetch_master or self._download_master)(input)
        card = CharacterCard(name=f"char-{input.character_id}", desc=input.custom_prompt or "")
        action = ActionSpec(
            action=_to_engine_action(input.action_type),
            poses=[""] * input.num_frames,
            facing=facing,
            stylize="none",
        )
        progress: ProgressPort = _LogProgress()
        generated = self._get_generator().generate(card, action, master, progress)

        upload = self._upload or self._upload_frame
        frames = [
            {"index": i, "image_url": upload(png), "duration_ms": dur}
            for i, (png, dur) in enumerate(zip(generated.frames, generated.durations))
        ]
        return {"action_type": input.action_type.value, "frames": frames}

    def _get_generator(self) -> CharacterGeneratorPort:
        """懒装配真实 CharacterGenerator(视频路线 + 桩路线)。"""
        if self._generator is None:
            from windup_ai_engine.impl import CharacterGenerator
            from windup_ai_engine.strategy.concrete import (
                PerFrameStrategy,
                ProcIdleStrategy,
                VideoFrameStrategy,
            )
            from windup_common.models import GenRoute
            from windup_framework.providers import (
                OnnxU2NetMatteProvider,
                SufyImageProvider,
                SufyVideoProvider,
            )

            matte = OnnxU2NetMatteProvider()
            video = SufyVideoProvider()
            image = SufyImageProvider()
            self._generator = CharacterGenerator({
                GenRoute.VIDEO_I2V: VideoFrameStrategy(video, matte),
                GenRoute.PER_FRAME: PerFrameStrategy(image, matte),
                GenRoute.PROC_IDLE: ProcIdleStrategy(image, matte),
            })
        return self._generator

    def _download_master(self, input: CharacterActionInput) -> bytes:
        if not input.reference_image_urls:
            raise ValueError("缺少母版:reference_image_urls 为空")
        resp = httpx.get(input.reference_image_urls[0], timeout=30.0)
        resp.raise_for_status()
        return resp.content

    def _upload_frame(self, png: bytes) -> str:
        from windup_app.server.media.model import MediaCategory, MediaUploadInput
        from windup_app.server.media.service import service as media_service

        meta = MediaUploadInput(
            filename="frame.png",
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


# 默认执行器(真实依赖);bootstrap 取 run_action_task 注入 app.state
executor = ActionTaskExecutor()
run_action_task = executor.run_action_task
