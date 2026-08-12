"""align_bottom_center 的交付画布几何(2026-08-11 挣得)。

为什么要这组用例:交付帧一直写死出 256×256 方形,而项目的 sprite 尺寸是
``sprite_width×sprite_height``(32~2048,可非方)。上层拿到 256 的帧再 ``_fit_to``
到项目尺寸,用的是 ``Image.thumbnail`` —— **它只缩不放**:项目要 512 时帧根本不会被
放大,而是原尺寸居中贴进 512 画布,刚对齐好的脚线 0.92 被挪到 0.709(实测),角色不站
在地上了。所以引擎必须能一次出到目标尺寸,而不是让上层再缩一次。
"""

import numpy as np
from PIL import Image

from windup_ai_engine.postprocess.pack import align_bottom_center

FILL_H = 0.62      # 与 pack.align_bottom_center 的默认值一致
FOOT_LINE = 0.92


def _frames(n=4, w=640, h=480, bh=300, bw=60):
    """造一组"角色在画布里漂移"的帧(align 要消掉的正是这个漂移)。"""
    out = []
    for i in range(n):
        a = np.zeros((h, w, 4), dtype=np.uint8)
        x0, y0 = 200 + i * 7, 60 + i * 5
        a[y0:y0 + bh, x0:x0 + bw] = (200, 80, 60, 255)
        out.append(Image.fromarray(a, "RGBA"))
    return out


def _subject(img: Image.Image):
    """返回 (高, 脚线比例, 水平中心比例)。"""
    a = np.asarray(img)[:, :, 3]
    ys, xs = np.nonzero(a > 128)
    w, h = img.size
    return int(ys.max() - ys.min() + 1), (int(ys.max()) + 1) / h, (int(xs.min()) + int(xs.max())) / 2 / w


def test_default_canvas_is_256_square_with_foot_line_geometry():
    """默认仍是 256 方形,脚线 0.92、主体占高 0.62、水平居中。"""
    out = align_bottom_center(_frames(), ref_height=300.0)
    assert out[0].size == (256, 256)
    height, foot, center = _subject(out[0])
    assert abs(height - 256 * FILL_H) <= 2
    assert abs(foot - FOOT_LINE) <= 0.01
    assert abs(center - 0.5) <= 0.01


def test_omitting_cell_h_is_pixel_identical_to_square_cell():
    """不传 cell_h == 传 cell_h=cell —— 默认行为一个像素都不许变。"""
    src = _frames()
    a = align_bottom_center(src, ref_height=300.0)
    b = align_bottom_center(src, ref_height=300.0, cell_h=256)
    for x, y in zip(a, b, strict=True):
        assert np.array_equal(np.asarray(x), np.asarray(y))


def test_doubling_cell_doubles_subject_height():
    """指定 512 时交付帧主体高度翻倍 —— 这正是"交付帧太小"的修法。"""
    src = _frames()
    small = align_bottom_center(src, ref_height=300.0)
    big = align_bottom_center(src, ref_height=300.0, cell=512)
    assert big[0].size == (512, 512)
    h_small = _subject(small[0])[0]
    h_big = _subject(big[0])[0]
    assert abs(h_big / h_small - 2.0) < 0.05, f"期望约翻倍,实际 {h_small} → {h_big}"


def test_non_square_canvas_applies_each_axis_to_the_right_dimension():
    """非方形画布:高度几何(脚线 / 占高)按高走,水平居中按宽走 —— 不能串轴。"""
    out = align_bottom_center(_frames(), ref_height=300.0, cell=384, cell_h=512)
    assert out[0].size == (384, 512)
    height, foot, center = _subject(out[0])
    assert abs(height - 512 * FILL_H) <= 2, "主体占高必须按画布高算"
    assert abs(foot - FOOT_LINE) <= 0.01, "脚线必须按画布高算"
    assert abs(center - 0.5) <= 0.01, "水平居中必须按画布宽算"


def test_subject_fill_ratio_is_scale_invariant():
    """几何是"比例"不是"像素":换画布尺寸,主体占画布高的比例不变。

    这条是"母版入口预检与出帧共用同一套几何"的直接证据 —— 预检阈值
    (master_check.REJECT_ASPECT = 2*FILL_W/FILL_H)里没有 cell,本就与画布像素尺寸无关。
    """
    src = _frames()
    ratios = []
    for cell in (128, 256, 512, 1024):
        out = align_bottom_center(src, ref_height=300.0, cell=cell)
        ratios.append(_subject(out[0])[0] / cell)
    assert max(ratios) - min(ratios) < 0.01, f"占高比例应恒定,实测 {ratios}"


def test_width_fallback_uses_canvas_width_not_height():
    """宽度兜底(横向长条主体)要按画布**宽**收缩,否则宽画布上会白白缩小主体。"""
    wide = [f.transpose(Image.ROTATE_90) for f in _frames(bh=300, bw=60)]
    narrow = align_bottom_center(wide, cell=256, cell_h=256)
    widened = align_bottom_center(wide, cell=512, cell_h=256)
    # 画布变宽后,宽度兜底放松,主体应当更大(若按高算则两者相同)
    assert _subject(widened[0])[0] > _subject(narrow[0])[0]


def test_non_positive_canvas_raises_instead_of_emitting_empty_image():
    """0 边长不静默出图:PIL 允许建 0×0,错产物要到落库/前端才暴露。"""
    import pytest

    for kw in (dict(cell=0), dict(cell_h=0), dict(cell=-1)):
        with pytest.raises(ValueError, match="画布尺寸"):
            align_bottom_center(_frames(), **kw)


def test_all_transparent_frames_still_honour_requested_canvas():
    """全透明输入的兜底画布也要用请求的尺寸,不能退回 256 方形。"""
    blank = [Image.new("RGBA", (64, 64), (0, 0, 0, 0)) for _ in range(3)]
    out = align_bottom_center(blank, cell=320, cell_h=200)
    assert [f.size for f in out] == [(320, 200)] * 3
