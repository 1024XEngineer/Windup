"""像素化后处理测试(纯 CV,无需联网 / API)。"""

import numpy as np
from PIL import Image

from windup_ai_engine.postprocess import (
    pixelate_frames,
    sprite_sheet,
    to_pixel_art,
)


def _synthetic_char(size=256, box=(80, 40, 176, 220)) -> Image.Image:
    """透明底上画一个不透明矩形"角色",四周留透明边。"""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    arr = np.asarray(img).copy()
    x0, y0, x1, y1 = box
    arr[y0:y1, x0:x1] = (200, 60, 60, 255)
    # 加一点颜色变化,让色板量化有意义
    arr[y0:y1, x0 : (x0 + x1) // 2] = (60, 120, 200, 255)
    return Image.fromarray(arr, "RGBA")


def test_to_pixel_art_targets_height_and_keeps_ratio():
    src = _synthetic_char()  # 主体 96x180
    out = to_pixel_art(src, target_h=60, palette_size=16)
    assert out.height == 60
    # 主体宽高比 96/180 → 目标宽 ≈ 60*96/180 = 32
    assert abs(out.width - 32) <= 1
    assert out.mode == "RGBA"


def test_to_pixel_art_crops_to_alpha_bbox():
    """输出应裁到主体包围盒:透明边被切掉,首列即主体。"""
    out = to_pixel_art(_synthetic_char(), target_h=90, palette_size=16)
    alpha = np.asarray(out)[:, :, 3]
    assert alpha.max() == 255  # 有实心主体
    # 顶行与左列应落在主体上(已裁边),而非全透明
    assert alpha[0, :].max() > 0
    assert alpha[:, 0].max() > 0


def test_to_pixel_art_reduces_palette():
    out = to_pixel_art(_synthetic_char(), target_h=80, palette_size=8)
    rgb = np.asarray(out.convert("RGB")).reshape(-1, 3)
    colors = np.unique(rgb, axis=0)
    assert len(colors) <= 8


def test_pixelate_frames_uniform_height_packs_to_sheet():
    frames = pixelate_frames([_synthetic_char() for _ in range(4)], target_h=48, palette_size=16)
    assert all(f.height == 48 for f in frames)
    sheet = sprite_sheet(frames)
    assert sheet.height == 48
    assert sheet.width == sum(f.width for f in frames)


def test_to_pixel_art_rejects_bad_height():
    import pytest

    with pytest.raises(ValueError):
        to_pixel_art(_synthetic_char(), target_h=0)


def _pixel_art(block=8, logical_h=20, bg=(255, 255, 255)) -> Image.Image:
    """合成像素画:每个逻辑像素放大成 block×block 方块,白底(模拟母版)。"""
    colors = [(200, 60, 60), (60, 120, 200), (40, 160, 90)]
    small = np.full((logical_h, logical_h // 2, 3), bg, dtype=np.uint8)
    for y in range(4, logical_h - 4):
        for x in range(2, logical_h // 2 - 2):
            small[y, x] = colors[(x + y) % len(colors)]
    img = Image.fromarray(small, "RGB").resize(
        (small.shape[1] * block, logical_h * block), Image.NEAREST
    )
    return img.convert("RGBA")


def test_detect_pixel_size_finds_block():
    from windup_ai_engine.postprocess import detect_pixel_size

    assert detect_pixel_size(_pixel_art(block=8)) == 8
    assert detect_pixel_size(_pixel_art(block=12)) == 12


def test_master_pixel_spec_gives_logical_height_and_palette():
    from windup_ai_engine.postprocess import master_pixel_spec

    logical_h, palette = master_pixel_spec(_pixel_art(block=8, logical_h=20))
    assert 10 <= logical_h <= 14      # 主体(去掉白边)约 12 个逻辑像素高
    assert 2 <= len(palette) <= 32
    # 色板不应被白底/抗锯齿近白色占据
    assert not (palette.astype(int).sum(axis=1) > 700).all()


def test_palette_lock_restricts_output_colors():
    """锁色板后,输出颜色必须全部来自给定色板(用于消掉压缩灰颗粒)。"""
    palette = np.array([[200, 60, 60], [60, 120, 200]], dtype=np.uint8)
    noisy = _synthetic_char()
    out = to_pixel_art(noisy, target_h=24, palette=palette)
    rgb = np.asarray(out.convert("RGB")).reshape(-1, 3)
    used = np.unique(rgb, axis=0)
    for c in used:
        assert (c == palette).all(axis=1).any(), f"{c} 不在色板内"
