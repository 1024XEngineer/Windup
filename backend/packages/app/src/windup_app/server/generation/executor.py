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
from dataclasses import dataclass
from typing import TYPE_CHECKING

import httpx
from sqlalchemy.orm import Session

from windup_common.models import ActionSpec, ActionType as EngineActionType, CharacterCard

from windup_app.server.generation import task_repo
from windup_app.server.generation.model import (
    CharacterActionInput,
    CharacterImageInput,
    TaskStatus,
)

if TYPE_CHECKING:
    from windup_ai_engine.ports import CharacterGeneratorPort, ProgressPort

logger = logging.getLogger("windup.generation.executor")

_ACTION_RESULT = "character_action"  # task_repo._deserialize_result 按此标签反序列化

# ── 项目全局约束(Project 表)→ 统合喂给生成逻辑 ─────────────────────────
# character_perspective 游戏视角:1=横版(侧视) 2=俯视 3=2.5D → 生成朝向/视角
_PERSPECTIVE_FACING: dict[int, str] = {1: "side", 2: "front", 3: "front"}
_PERSPECTIVE_VIEW: dict[int, str] = {
    1: "side view, horizontal side-scroller",
    2: "top-down view",
    3: "2.5D three-quarter view",
}
# directional_movement 移动方向:1=单向 2=四向 3=八向 → 需生成的方向数
_MOVEMENT_DIRECTIONS: dict[int, int] = {1: 1, 2: 4, 3: 8}


@dataclass
class ProjectConstraints:
    """从 Project 取的全局生成约束,统一约束角色图/动作生成。"""

    facing: str = "side"        # character_perspective → 朝向(须与母版一致 #35)
    view: str = "side view, horizontal side-scroller"
    perspective: int = 1        # 1横版 2俯视 3 2.5D
    directions: int = 1         # directional_movement → 方向数(1/4/8)
    sprite_w: int = 256         # 输出/切帧尺寸(关键)
    sprite_h: int = 256
    style: str = ""             # game_style 画风
    stylize: str = "none"       # 由 style 推:像素游戏 → pixel
    sprite_sample_url: str = "" # 项目风格参考图 URL


def _load_constraints(session: Session, project_id: int | None) -> ProjectConstraints:
    """查 Project 组装全局约束;无 project_id / 查不到 → 缺省。"""
    if project_id is None:
        return ProjectConstraints()
    from windup_app.server.project.service import SqlAlchemyProjectService

    p = SqlAlchemyProjectService().get_project(session, project_id)
    if p is None:
        return ProjectConstraints()
    style = p.game_style or ""
    is_pixel = "pixel" in style.lower() or "像素" in style
    return ProjectConstraints(
        facing=_PERSPECTIVE_FACING.get(p.character_perspective, "side"),
        view=_PERSPECTIVE_VIEW.get(p.character_perspective, _PERSPECTIVE_VIEW[1]),
        perspective=p.character_perspective,
        directions=_MOVEMENT_DIRECTIONS.get(p.directional_movement, 1),
        sprite_w=p.sprite_width,
        sprite_h=p.sprite_height,
        style=style,
        stylize="pixel" if is_pixel else "none",
        sprite_sample_url=p.sprite_sample_url or "",
    )


def _fit_to(png: bytes, w: int, h: int) -> bytes:
    """把帧等比缩放进 w×h(透明补边),落实项目 sprite 尺寸约束。"""
    import io

    from PIL import Image

    im = Image.open(io.BytesIO(png)).convert("RGBA")
    if im.size == (w, h):
        return png
    fitted = im.copy()
    fitted.thumbnail((w, h), Image.NEAREST)
    canvas = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    canvas.alpha_composite(fitted, ((w - fitted.width) // 2, (h - fitted.height) // 2))
    buf = io.BytesIO()
    canvas.save(buf, "PNG")
    return buf.getvalue()


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
        fetch_constraints: Callable[[Session, int | None], ProjectConstraints] | None = None,
        session_factory: Callable[[], Session] | None = None,
    ) -> None:
        self._generator = generator          # None → 懒加载真实装配
        self._upload = upload                # None → 真实对象存储上传
        self._fetch_master = fetch_master    # None → 下载 reference_image_urls[0]
        self._fetch_constraints = fetch_constraints  # None → 查 project 全局约束
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

        先从 ``project`` 取全局约束(朝向/画风/尺寸/方向)再调 ai_engine。``session``
        缺省时自开一个(后台场景);测试可传入自己的 session。
        """
        own = session is None
        session = session or self._make_session()
        try:
            task_repo.update_status(session, task_id, TaskStatus.RUNNING)
            if own:
                session.commit()

            cons = (self._fetch_constraints or _load_constraints)(session, project_id)
            result = self._produce_action(input, cons)
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

    def _produce_action(self, input: CharacterActionInput, cons: ProjectConstraints) -> dict:
        """母版 → ai_engine 出帧 → 按项目尺寸切帧 → 逐帧上传 → 组结果 dict。

        项目约束落实:``facing`` 随视角、``stylize`` 随画风(像素游戏→像素化)、
        输出帧尺寸随 ``sprite_w×sprite_h``。方向数(directions)MVP 先出主方向,
        四向/八向为扩展(需多次生成或镜像)。
        """
        if cons.directions > 1:
            logger.info("项目要求 %s 方向,MVP 先出主方向(多方向待扩展)", cons.directions)
        master = (self._fetch_master or self._download_master)(input)
        # 视频 i2v 没有独立的 style reference 字段,风格约束走提示词文字
        desc_parts = [input.custom_prompt or ""]
        if cons.style:
            desc_parts.append(f"Art style: {cons.style}")
        card = CharacterCard(name=f"char-{input.character_id}", desc=" ".join(desc_parts))
        action = ActionSpec(
            action=_to_engine_action(input.action_type),
            poses=[""] * input.num_frames,
            facing=cons.facing,
            stylize=cons.stylize,
        )
        progress: ProgressPort = _LogProgress()
        generated = self._get_generator().generate(card, action, master, progress)

        upload = self._upload or self._upload_frame
        frames = [
            {"index": i,
             "image_url": upload(_fit_to(png, cons.sprite_w, cons.sprite_h)),
             "duration_ms": dur}
            for i, (png, dur) in enumerate(zip(generated.frames, generated.durations))
        ]
        return {"type": "character_action", "action_type": input.action_type.value, "frames": frames}

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


_IMAGE_RESULT = "character_image"  # task_repo._deserialize_result 按此标签反序列化


class ImageTaskExecutor:
    """跑角色图片生成任务:参考图 + prompt → 图生图 → 上传 → 回写 image_url。"""

    def __init__(
        self,
        *,
        image=None,                                      # None → 懒加载 SufyImageProvider
        upload: Callable[[bytes], str] | None = None,    # None → 真实对象存储上传
        fetch_ref: Callable[[str], bytes] | None = None, # None → 下载 reference_image_url
        session_factory: Callable[[], Session] | None = None,
    ) -> None:
        self._image = image
        self._upload = upload
        self._fetch_ref = fetch_ref
        self._session_factory = session_factory

    def run_image_task(
        self,
        task_id: int,
        input: CharacterImageInput,
        project_id: int | None = None,
        *,
        session: Session | None = None,
    ) -> None:
        own = session is None
        session = session or self._make_session()
        try:
            task_repo.update_status(session, task_id, TaskStatus.RUNNING)
            if own:
                session.commit()
            cons = _load_constraints(session, project_id)   # 角色图也受项目约束
            urls = self._produce_image(input, cons)
            task_repo.update_result(session, task_id, _IMAGE_RESULT, {
                "type": "character_image",
                "image_urls": urls,
            })
            if own:
                session.commit()
        except Exception as exc:  # noqa: BLE001 —— 兜底
            logger.exception("图片任务 %s 失败", task_id)
            task_repo.update_status(session, task_id, TaskStatus.FAILED, error_message=str(exc))
            if own:
                session.commit()
        finally:
            if own:
                session.close()

    def _produce_image(self, input: CharacterImageInput, cons: ProjectConstraints) -> list[str]:
        """根据项目约束决定生成模式,返回 URL 列表。

        模式判断:
          - 项目有 sprite_sample_url → **图生图**: 风格参考图 + 提示词
          - 项目无 sprite_sample_url → **文生图**: 纯提示词
        用户传入的 reference_image_url 始终作为角色一致性参考(可选)。
        """
        fetch = self._fetch_ref or self._download
        refs: list[bytes] = []
        has_style_ref = False

        # 1. 角色参考图(用户传入,可选,做角色一致性约束)
        char_url = (input.reference_image_url or "").strip()
        if char_url and char_url.lower() not in ("null", "none", ""):
            refs.append(fetch(char_url))

        # 2. 风格参考图(项目级,有 sprite_sample_url 时走图生图模式)
        style_url = (cons.sprite_sample_url or "").strip()
        if style_url and style_url.lower() not in ("null", "none", ""):
            try:
                refs.append(fetch(style_url))
                has_style_ref = True
            except Exception:
                pass  # 风格参考图下载失败不阻断

        # 3. 构建提示词
        base = input.prompt or "Clean full-body character reference of the figure in the image."
        parts = [base, f"{cons.view}, full body head to feet, centered."]
        if cons.style:
            parts.append(f"Art style: {cons.style}.")
        parts.append("Plain light-gray background, no shadow.")

        # 图生图模式:明确标注两张图的各自用途
        if has_style_ref:
            prefix = (
                "This is an image-to-image task. "
                "The first image is the CHARACTER reference — preserve its identity. "
                "The second image is the STYLE reference — follow its art style, "
                "color palette, and rendering technique. "
            )
            parts.insert(0, prefix)

        prompt = " ".join(parts)

        image_gen = self._get_image()
        upload = self._upload or self._upload_image
        urls: list[str] = []
        for _ in range(max(1, input.num_images)):
            img = image_gen.gen_image(prompt, refs)
            urls.append(upload(img))
        return urls

    def _get_image(self):
        if self._image is None:
            from windup_framework.providers import SufyImageProvider

            self._image = SufyImageProvider()
        return self._image

    def _download(self, url: str) -> bytes:
        resp = httpx.get(url, timeout=30.0)
        resp.raise_for_status()
        return resp.content

    def _upload_image(self, png: bytes) -> str:
        from windup_app.server.media.model import MediaCategory, MediaUploadInput
        from windup_app.server.media.service import service as media_service

        meta = MediaUploadInput(
            filename="character.png", content_type="image/png",
            size=len(png), category=MediaCategory.REFERENCE_IMAGE,
        )
        return media_service.upload(png, meta).url

    def _make_session(self) -> Session:
        if self._session_factory is not None:
            return self._session_factory()
        from windup_framework.db.session import SessionLocal

        return SessionLocal()


# 默认执行器(真实依赖);bootstrap 取 run_action_task / run_image_task 注入 app.state
executor = ActionTaskExecutor()
run_action_task = executor.run_action_task
image_executor = ImageTaskExecutor()
run_image_task = image_executor.run_image_task
