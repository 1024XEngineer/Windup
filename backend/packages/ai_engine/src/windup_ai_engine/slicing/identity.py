"""立绘格 vs 正视母版的身份读数与站立 QC。

直方图口径跟 PerfectPixel Studio 一样:64-bin RGB 交,门槛 0.40。背面系
(north / NE / NW)会对背面误报,跳过身份。母版几乎不透明时直方图会被底色污染,
也跳过(他们 ``hasTransparency`` ≥5%)。

``inspect_standing_cell`` 是站立版 InspectFrames:空图 / 身份 / east 正面漂为
Error,贴边只记 Hint。执行器拿 Error 重画,最多 ``STANDING_QC_ATTEMPTS`` 次。
"""

from __future__ import annotations

import dataclasses

import numpy as np
from PIL import Image

from windup_common.directions import ActionDirection

__all__ = [
    "IDENTITY_ERROR_SIM",
    "PROFILE_FRONT_DRIFT",
    "STANDING_QC_ATTEMPTS",
    "StandingInspect",
    "has_transparency",
    "histogram_intersection",
    "identity_similarity",
    "inspect_standing_cell",
    "is_back_facing",
]

IDENTITY_ERROR_SIM = 0.40
STANDING_QC_ATTEMPTS = 3
PROFILE_FRONT_DRIFT = 0.85
_INSPECT_EDGE_MARGIN = 2
_INSPECT_EDGE_MAX = 24
_BACK_FACING = frozenset(
    {
        ActionDirection.NORTH,
        ActionDirection.NORTH_EAST,
        ActionDirection.NORTH_WEST,
    }
)
_HIST_BINS = 64


@dataclasses.dataclass(frozen=True)
class StandingInspect:
    ok: bool
    hints: tuple[str, ...]
    identity_sim: float | None
    score: int
    errors: int


def is_back_facing(direction: ActionDirection | str) -> bool:
    return ActionDirection(direction) in _BACK_FACING


def has_transparency(
    image: Image.Image, alpha_thr: int = 128, min_frac: float = 0.05,
) -> bool:
    """透明像素占比达到 ``min_frac`` 才算有可抠的底。全涂满的测试图会跳过身份 / 朝向。"""
    arr = np.asarray(image.convert("RGBA"))
    total = int(arr.shape[0] * arr.shape[1])
    if total == 0:
        return False
    return float((arr[:, :, 3] <= alpha_thr).sum()) / total >= min_frac


def color_histogram(image: Image.Image, alpha_thr: int = 128) -> np.ndarray:
    arr = np.asarray(image.convert("RGBA"))
    mask = arr[:, :, 3] > alpha_thr
    pixels = arr[mask][:, :3]
    hist = np.zeros(_HIST_BINS, dtype=np.float64)
    if len(pixels) == 0:
        return hist
    bins = (
        (pixels[:, 0].astype(np.int32) >> 6) << 4
        | (pixels[:, 1].astype(np.int32) >> 6) << 2
        | (pixels[:, 2].astype(np.int32) >> 6)
    )
    counts = np.bincount(bins, minlength=_HIST_BINS).astype(np.float64)
    total = counts.sum()
    if total > 0:
        hist = counts / total
    return hist


def histogram_intersection(a: np.ndarray, b: np.ndarray) -> float:
    return float(np.minimum(a, b).sum())


def identity_similarity(frame: Image.Image, master: Image.Image) -> float:
    """不透明像素 64-bin RGB 直方图交,0~1。"""
    return histogram_intersection(color_histogram(frame), color_histogram(master))


def _subject_wh(image: Image.Image) -> tuple[int, int] | None:
    box = image.convert("RGBA").getchannel("A").getbbox()
    if box is None:
        return None
    x0, y0, x1, y1 = box
    width, height = x1 - x0, y1 - y0
    if width < 1 or height < 1:
        return None
    return width, height


def inspect_standing_cell(
    frame: Image.Image,
    master: Image.Image,
    direction: ActionDirection | str,
) -> StandingInspect:
    """抠图后、吸附 / 对齐前检查一格。只对 Error 判失败;贴边是 Warning。"""
    azimuth = ActionDirection(direction)
    arr = np.asarray(frame.convert("RGBA"))
    height, width = arr.shape[:2]
    opaque = arr[:, :, 3] > 128
    content = int(opaque.sum())
    hints: list[str] = []
    errors = 0
    sim: float | None = None

    # PerfectPixel 的 400 是 256² 格上的绝对值;这里用同一条相对口径:画布的 1%。
    min_content = max(width * height // 100, 1)
    if content < min_content:
        errors += 1
        hints.append(
            "Every view must hold one complete, fully drawn full-body character. "
            "Leave no view empty or faint."
        )

    if has_transparency(frame):
        margin = _INSPECT_EDGE_MARGIN
        edge = int(
            opaque[:margin, :].sum()
            + opaque[-margin:, :].sum()
            + opaque[margin:-margin, :margin].sum()
            + opaque[margin:-margin, -margin:].sum()
        )
        if edge > _INSPECT_EDGE_MAX:
            hints.append(
                "Keep the whole figure inside the frame with clear padding on all "
                "sides; no body part may touch or cross the edge."
            )

    if (
        not is_back_facing(azimuth)
        and has_transparency(master)
        and has_transparency(frame)
    ):
        sim = identity_similarity(frame, master)
        if sim < IDENTITY_ERROR_SIM:
            errors += 1
            hints.append(
                "CRITICAL: the previous attempt drew a different-looking character. "
                "Copy the attached FRONT-VIEW master's identity exactly — identical "
                "hair color, skin tone, outfit colors, proportions and accessories."
            )

    if (
        azimuth is ActionDirection.EAST
        and has_transparency(master)
        and has_transparency(frame)
    ):
        south_wh = _subject_wh(master)
        cell_wh = _subject_wh(frame)
        if south_wh is not None and cell_wh is not None:
            south_w, south_h = south_wh
            cell_w, cell_h = cell_wh
            width_at_south_h = cell_w * (south_h / cell_h)
            if width_at_south_h >= PROFILE_FRONT_DRIFT * south_w:
                errors += 1
                hints.append(
                    "Never drift back toward a front view. Required view is a true "
                    "right-side profile: camera at the character's right, one eye and "
                    "one ear, left limbs hidden behind the body."
                )

    return StandingInspect(
        ok=errors == 0,
        hints=tuple(hints),
        identity_sim=sim,
        score=content - errors * 10,
        errors=errors,
    )
