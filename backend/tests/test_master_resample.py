"""母版缩到项目尺寸时的重采样:像素项目必须保住网格与色板。"""

import io

import numpy as np
import pytest
from PIL import Image

from windup_app.server.orchestrator.executor import _fit_to
from windup_ai_engine.postprocess.pixelate import detect_pixel_size, master_pixel_spec

BLOCK = 8
CANVAS = 1024
PALETTE = np.array(
    [(220, 40, 40), (40, 200, 90), (40, 90, 220), (240, 220, 60), (30, 30, 40)],
    np.uint8,
)


def _pixel_master() -> bytes:
    """真值可控:块边长、色板、逻辑高都已知,读数不对能立刻分清是量具还是被测对象。"""
    rng = np.random.default_rng(7)
    a = np.zeros((CANVAS, CANVAS, 4), np.uint8)
    for by in range(24, 104):                       # 主体 640px 高 → 逻辑高 80
        for bx in range(40, 88):
            y, x = by * BLOCK, bx * BLOCK
            a[y : y + BLOCK, x : x + BLOCK, :3] = PALETTE[rng.integers(0, len(PALETTE))]
            a[y : y + BLOCK, x : x + BLOCK, 3] = 255
    buf = io.BytesIO()
    Image.fromarray(a, "RGBA").save(buf, "PNG")
    return buf.getvalue()


def _read(png: bytes) -> tuple[int, int, float]:
    im = Image.open(io.BytesIO(png)).convert("RGBA")
    arr = np.asarray(im)
    visible = arr[arr[:, :, 3] > 128][:, :3]
    logical_h, _ = master_pixel_spec(im)
    off_palette = 1.0 - np.isin(visible, PALETTE).all(1).mean()
    return detect_pixel_size(im), logical_h, float(off_palette)


def test_pixel_master_keeps_its_grid_and_palette():
    """像素母版缩完仍是同一张像素画;插值会让色板里一个原色都不剩。"""
    block, logical_h, off = _read(_fit_to(_pixel_master(), 256, 256, smooth=False))

    assert off == 0.0, f"缩放引入了色板外颜色:{off:.1%}"
    assert logical_h == 80, f"逻辑高应保持 80,实际 {logical_h}"
    assert block > 1, "网格被抹掉了(检不出块边长)"


def test_smoothing_a_pixel_master_destroys_it():
    """记录被修的那个坏例,免得哪天有人把 smooth 改回恒 True 而没有一处会红。"""
    block, logical_h, off = _read(_fit_to(_pixel_master(), 256, 256, smooth=True))

    assert off > 0.9
    assert logical_h != 80
    assert block == 1


@pytest.mark.parametrize("smooth", [True, False])
def test_fit_to_always_lands_on_the_requested_canvas(smooth):
    png = _fit_to(_pixel_master(), 256, 256, smooth=smooth)
    assert Image.open(io.BytesIO(png)).size == (256, 256)
