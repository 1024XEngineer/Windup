"""四向 / 八向立绘 sheet 编排。

从已确认正视母版(south)图生图出源方向;抠图后按 PerfectPixel 口径检查身份 /
空图 / east 正面漂,失败把英文 Hint 喂进下一轮,最多 3 次,不行留最好的一张。
镜像格水平翻转后上传,再拼一张 3×3 罗盘。
不经过 ``ImageTaskExecutor._produce_image`` / ``DirectionSetTaskExecutor``。

web **不得 import 本模块**(与 ``executor`` 同门禁:会牵出 ai_engine)。
"""

from __future__ import annotations

import dataclasses
import io
import logging
import threading
from collections.abc import Callable
from typing import TYPE_CHECKING

from PIL import Image
from sqlalchemy.orm import Session

from windup_ai_engine.postprocess import master_pixel_spec, to_pixel_art
from windup_ai_engine.prompt import build_view_sheet_prompt
from windup_ai_engine.slicing.identity import (
    STANDING_QC_ATTEMPTS,
    identity_similarity,
    inspect_standing_cell,
    is_back_facing,
)
from windup_ai_engine.slicing.quality import subject_blobs
from windup_common.directions import ActionDirection
from windup_common.models import CharacterView
from windup_framework.gateway import bind_call_context, fresh_gateway_request

from windup_app.server.orchestrator import generation_io, task_repo
from windup_app.server.orchestrator._failure import user_message
from windup_app.server.orchestrator._fetch import fetch_own_media
from windup_app.server.orchestrator.executor import (
    ProjectConstraints,
    _close_failed,
    _fit_to,
    _load_constraints,
    _require_size,
    _settle_credit,
)
from windup_app.server.orchestrator.model import (
    CharacterViewSheetCandidate,
    CharacterViewSheetCell,
    CharacterViewSheetInput,
    CharacterViewSheetOutput,
    GenerationType,
    TaskStatus,
)

if TYPE_CHECKING:
    from windup_framework.providers import MatteProvider

logger = logging.getLogger("windup.generation.view_sheet")

_FOUR_SOURCES = (ActionDirection.EAST, ActionDirection.NORTH)
_EIGHT_SOURCES = (
    ActionDirection.EAST,
    ActionDirection.NORTH,
    ActionDirection.NORTH_EAST,
    ActionDirection.SOUTH_EAST,
)
_MIRRORS = (
    (ActionDirection.WEST, ActionDirection.EAST),
    (ActionDirection.NORTH_WEST, ActionDirection.NORTH_EAST),
    (ActionDirection.SOUTH_WEST, ActionDirection.SOUTH_EAST),
)
# 列、行;中心 (1,1) 不贴。
_CELL_GRID: dict[ActionDirection, tuple[int, int]] = {
    ActionDirection.NORTH_WEST: (0, 0),
    ActionDirection.NORTH: (1, 0),
    ActionDirection.NORTH_EAST: (2, 0),
    ActionDirection.WEST: (0, 1),
    ActionDirection.EAST: (2, 1),
    ActionDirection.SOUTH_WEST: (0, 2),
    ActionDirection.SOUTH: (1, 2),
    ActionDirection.SOUTH_EAST: (2, 2),
}
_PERSPECTIVE_TO_VIEW = {
    1: CharacterView.SIDE,
    2: CharacterView.TOP_DOWN,
    3: CharacterView.ISOMETRIC,
}


def source_directions_for(task_type: GenerationType) -> tuple[ActionDirection, ...]:
    if task_type is GenerationType.CHARACTER_FOUR_VIEW:
        return _FOUR_SOURCES
    if task_type is GenerationType.CHARACTER_EIGHT_VIEW:
        return _EIGHT_SOURCES
    raise ValueError(f"不是立绘 sheet 任务: {task_type}")


def flip_horizontal(png: bytes) -> bytes:
    """水平翻转后重新编码。镜像格上传前调用;拼 sheet 时不再翻。"""
    im = Image.open(io.BytesIO(png)).convert("RGBA")
    buf = io.BytesIO()
    im.transpose(Image.FLIP_LEFT_RIGHT).save(buf, "PNG")
    return buf.getvalue()


def _subject_box(im: Image.Image) -> tuple[int, int, int, int] | None:
    """不透明包围盒,右/下为开区间。全透明返回 None。"""
    return im.convert("RGBA").getchannel("A").getbbox()


def pack_cell_to_master(
    png: bytes,
    master: Image.Image,
    width: int,
    height: int,
    *,
    nearest: bool,
) -> bytes:
    """把一格主体缩放到与南向母版同高,脚底与水平中心对齐后再写入 ``width``×``height``。

    对应 PerfectPixel ``ExtractFrames`` 的公共缩放 + 基线,但标尺是已确认的 south
    立绘,不是条带里最高的一帧。量不到包围盒时退回 ``_fit_to``。画布装不下时
    先按画布收一档缩放,再夹进画布 —— 不改母版 URL,也不在拼 sheet 时二次缩放。
    """
    src = Image.open(io.BytesIO(png)).convert("RGBA")
    master_rgba = master.convert("RGBA")
    master_box = _subject_box(master_rgba)
    src_box = _subject_box(src)
    if master_box is None or src_box is None:
        return _fit_to(png, width, height, smooth=not nearest)
    mx0, my0, mx1, my1 = master_box
    sx0, sy0, sx1, sy1 = src_box
    sub_w, sub_h = sx1 - sx0, sy1 - sy0
    master_h = my1 - my0
    if sub_w < 1 or sub_h < 1 or master_h < 1:
        return _fit_to(png, width, height, smooth=not nearest)
    scale = min(master_h / sub_h, width / sub_w, height / sub_h)
    new_w = max(1, round(sub_w * scale))
    new_h = max(1, round(sub_h * scale))
    crop = src.crop((sx0, sy0, sx1, sy1))
    if (new_w, new_h) != (sub_w, sub_h):
        crop = crop.resize(
            (new_w, new_h),
            Image.NEAREST if nearest else Image.LANCZOS,
        )
    left = round((mx0 + mx1) / 2 - new_w / 2)
    top = my1 - new_h
    if left < 0:
        left = 0
    elif left + new_w > width:
        left = width - new_w
    if top < 0:
        top = 0
    elif top + new_h > height:
        top = height - new_h
    canvas = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    canvas.alpha_composite(crop, (left, top))
    buf = io.BytesIO()
    canvas.save(buf, "PNG")
    return buf.getvalue()


def restore_pixel_cell(png: bytes, master: Image.Image, width: int, height: int) -> bytes:
    """按正视母版的逻辑网格与色板吸附一格,再 contain 进精灵画布。

    Perfect Pixel 的第二步是检测网格再采样;这里复用动作链路已有的
    ``master_pixel_spec`` / ``to_pixel_art``,不另引 OpenCV。量不出网格时退回
    NEAREST ``_fit_to``,与非像素路径的尺寸落实同一出口。
    """
    try:
        logical_h, palette = master_pixel_spec(master)
    except Exception:
        return _fit_to(png, width, height, smooth=False)
    if logical_h <= 8:
        return _fit_to(png, width, height, smooth=False)
    snapped = to_pixel_art(
        Image.open(io.BytesIO(png)).convert("RGBA"),
        target_h=logical_h,
        palette=palette,
    )
    buf = io.BytesIO()
    snapped.save(buf, "PNG")
    return _fit_to(buf.getvalue(), width, height, smooth=False)


def compose_compass_sheet(
    cells: dict[ActionDirection, bytes],
    width: int,
    height: int,
) -> bytes:
    """把已对齐的格子贴进 3×3 罗盘。缺的方向(四向斜角、中心)保持透明。"""
    sheet = Image.new("RGBA", (3 * width, 3 * height), (0, 0, 0, 0))
    for direction, png in cells.items():
        col, row = _CELL_GRID[direction]
        cell = Image.open(io.BytesIO(png)).convert("RGBA")
        if cell.size != (width, height):
            raise ValueError(
                f"{direction.value} 格尺寸 {cell.size[0]}×{cell.size[1]} "
                f"与项目精灵 {width}×{height} 不一致,拼装不做二次对齐。"
            )
        sheet.alpha_composite(cell, (col * width, row * height))
    buf = io.BytesIO()
    sheet.save(buf, "PNG")
    return buf.getvalue()


def _mirrors_for(
    sources: tuple[ActionDirection, ...],
) -> tuple[tuple[ActionDirection, ActionDirection], ...]:
    have = set(sources)
    return tuple((dst, src) for dst, src in _MIRRORS if src in have)


class ViewSheetTaskExecutor:
    """跑四向 / 八向立绘 sheet:图生图源方向 → 翻转镜像 → 拼 3×3 → 回写。"""

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

    def run_four_view_task(
        self,
        task_id: int,
        input: CharacterViewSheetInput,
        project_id: int | None = None,
        *,
        session: Session | None = None,
    ) -> None:
        self.run_view_sheet_task(
            task_id,
            input,
            GenerationType.CHARACTER_FOUR_VIEW,
            project_id,
            session=session,
        )

    def run_eight_view_task(
        self,
        task_id: int,
        input: CharacterViewSheetInput,
        project_id: int | None = None,
        *,
        session: Session | None = None,
    ) -> None:
        self.run_view_sheet_task(
            task_id,
            input,
            GenerationType.CHARACTER_EIGHT_VIEW,
            project_id,
            session=session,
        )

    def run_view_sheet_task(
        self,
        task_id: int,
        input: CharacterViewSheetInput,
        task_type: GenerationType,
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
            output = self._produce_sheets(input, task_type, cons)

            def _complete(s: Session) -> None:
                task_repo.update_result(
                    s,
                    task_id,
                    task_type.value,
                    dataclasses.asdict(output),
                )
                _settle_credit(s, task_id, success=True)

            generation_io.using_session(session, self._make_session, _complete)
        except Exception as exc:  # noqa: BLE001 —— 兜底
            logger.exception("立绘 sheet 任务 %s 失败", task_id)
            if session is not None:
                session.rollback()
            error_message = user_message(exc)

            def _fail(s: Session) -> None:
                _close_failed(s, task_id, error_message)

            generation_io.using_session(session, self._make_session, _fail)
        finally:
            if reset is not None:
                reset()

    def _produce_sheets(
        self,
        input: CharacterViewSheetInput,
        task_type: GenerationType,
        cons: ProjectConstraints,
    ) -> CharacterViewSheetOutput:
        sources = source_directions_for(task_type)
        mirrors = _mirrors_for(sources)
        fetch = self._fetch_ref or self._download
        master_png = _require_size(
            fetch(input.reference_image_url),
            input.width,
            input.height,
        )
        n_sheets = max(1, input.num_images or 1)
        from windup_framework.gateway.registry import ModelRegistry, candidate_models
        from windup_framework.gateway.types import Scene

        spread = candidate_models(
            ModelRegistry.from_settings().chain(Scene.CHARACTER_IMAGE),
            n_sheets,
        )
        jobs = [(sheet_i, direction) for sheet_i in range(n_sheets) for direction in sources]
        view = _PERSPECTIVE_TO_VIEW.get(cons.perspective, CharacterView.SIDE)
        extra = (input.prompt or "").strip()
        image_gen = self._get_image()
        matte = self._get_matte()
        upload = self._upload or self._upload_image
        refs = [master_png]
        south_im = Image.open(io.BytesIO(master_png)).convert("RGBA")

        def _gen_one(job: tuple[int, ActionDirection]) -> bytes:
            sheet_i, direction = job
            feedback = ""
            best_cut: bytes | None = None
            best_score = -10**9
            for _attempt in range(STANDING_QC_ATTEMPTS):
                reset_call = fresh_gateway_request(start_from_model=spread[sheet_i])
                try:
                    prompt = build_view_sheet_prompt(
                        direction,
                        view=view,
                        extra=extra,
                        stylize=cons.stylize,
                        feedback=feedback,
                    )
                    raw = image_gen.gen_image(prompt, refs)
                finally:
                    reset_call()
                cut = matte.cutout(raw)
                insp = inspect_standing_cell(
                    Image.open(io.BytesIO(cut)).convert("RGBA"),
                    south_im,
                    direction,
                )
                if insp.score > best_score:
                    best_cut, best_score = cut, insp.score
                if insp.ok:
                    return cut
                feedback = (
                    "QUALITY CORRECTIONS detected by automated inspection "
                    "(fix all of these): " + " ".join(insp.hints)
                )
            assert best_cut is not None
            return best_cut

        cuts = generation_io.io_map(_gen_one, jobs)
        fitted: list[bytes] = []
        cut_images: list[Image.Image] = []
        for cut in cuts:
            if cons.stylize == "pixel":
                png = restore_pixel_cell(cut, south_im, input.width, input.height)
                png = pack_cell_to_master(
                    png, south_im, input.width, input.height, nearest=True,
                )
            else:
                png = pack_cell_to_master(
                    cut, south_im, input.width, input.height, nearest=False,
                )
            cut_images.append(Image.open(io.BytesIO(png)).convert("RGBA"))
            fitted.append(png)

        sheets: list[CharacterViewSheetCandidate] = []
        n_sources = len(sources)
        for sheet_i in range(n_sheets):
            by_dir: dict[ActionDirection, bytes] = {
                ActionDirection.SOUTH: master_png,
            }
            offset = sheet_i * n_sources
            for j, direction in enumerate(sources):
                by_dir[direction] = fitted[offset + j]
            for dst, src in mirrors:
                by_dir[dst] = flip_horizontal(by_dir[src])

            upload_dirs = [d for d in by_dir if d is not ActionDirection.SOUTH]
            urls = generation_io.upload_frames(
                upload,
                [by_dir[d] for d in upload_dirs],
            )
            url_by_dir = {
                ActionDirection.SOUTH: input.reference_image_url,
                **dict(zip(upload_dirs, urls, strict=True)),
            }
            sheet_url = upload(compose_compass_sheet(by_dir, input.width, input.height))
            cells = [
                CharacterViewSheetCell(
                    direction=ActionDirection.SOUTH,
                    image_url=url_by_dir[ActionDirection.SOUTH],
                ),
            ]
            for direction in sources:
                cells.append(
                    CharacterViewSheetCell(
                        direction=direction,
                        image_url=url_by_dir[direction],
                    )
                )
            for dst, src in mirrors:
                cells.append(
                    CharacterViewSheetCell(
                        direction=dst,
                        image_url=url_by_dir[dst],
                        source_direction=src,
                        mirror_x=True,
                    )
                )
            sheets.append(CharacterViewSheetCandidate(sheet_url=sheet_url, cells=cells))

        identity_sim = []
        for (_, direction), img in zip(jobs, cut_images, strict=True):
            if is_back_facing(direction):
                continue
            identity_sim.append(
                {
                    "direction": direction.value,
                    "sim": round(identity_similarity(img, south_im), 4),
                }
            )
        return CharacterViewSheetOutput(
            type=task_type.value,
            sheets=sheets,
            quality={
                "subject_blobs": list(subject_blobs([south_im, *cut_images])),
                "identity_sim": identity_sim,
            },
        )

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
                from windup_framework.providers import OnnxU2NetMatteProvider

                self._matte = OnnxU2NetMatteProvider()
            return self._matte

    def _download(self, url: str) -> bytes:
        return fetch_own_media(url)

    def _upload_image(self, png: bytes) -> str:
        from windup_app.server.media.model import MediaCategory, MediaUploadInput
        from windup_app.server.media.service import service as media_service

        meta = MediaUploadInput(
            filename="character.png",
            content_type="image/png",
            size=len(png),
            category=MediaCategory.REFERENCE_IMAGE,
        )
        return media_service.upload(png, meta).url

    def _make_session(self) -> Session:
        if self._session_factory is not None:
            return self._session_factory()
        from windup_framework.db.session import SessionLocal

        return SessionLocal()


view_sheet_executor = ViewSheetTaskExecutor()
run_four_view_task = view_sheet_executor.run_four_view_task
run_eight_view_task = view_sheet_executor.run_eight_view_task
run_view_sheet_task = view_sheet_executor.run_view_sheet_task
