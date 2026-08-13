"""align_bottom_center 的交付画布几何(2026-08-11 挣得)。

为什么要这组用例:交付帧一直写死出 256×256 方形,而项目的 sprite 尺寸是
``sprite_width×sprite_height``(32~2048,可非方)。上层拿到 256 的帧再 ``_fit_to``
到项目尺寸,用的是 ``Image.thumbnail`` —— **它只缩不放**:项目要 512 时帧根本不会被
放大,而是原尺寸居中贴进 512 画布,刚对齐好的脚线 0.92 被挪到 0.709(实测),角色不站
在地上了。所以引擎必须能一次出到目标尺寸,而不是让上层再缩一次。
"""

import numpy as np
import pytest
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


# ── 跨动作尺寸一致性:定标基准不许被延展物撑大 ────────────────────────────


def _body(cell: int, bw: int, bh: int, exts=(), n: int = 8, size: int = 240):
    """本体尺寸恒定的合成序列;延展物按动作不同。本体用红色标记,便于在交付帧里量它。"""
    import numpy as np

    out = []
    for i in range(n):
        a = np.zeros((size, size, 4), np.uint8)
        y1 = size - 30
        y0, x0 = y1 - bh, (size - bw) // 2
        x1 = x0 + bw
        a[y0:y1, x0:x1] = (200, 80, 80, 255)                    # 本体
        for d, amp, osc in exts:
            k = int(amp * (abs(np.sin(i / n * 2 * np.pi)) if osc else 1.0))
            if k <= 0:
                continue
            if d == "up":
                a[max(0, y0 - k):y0, x0 + bw // 3:x0 + bw // 3 + 8] = (180, 140, 90, 255)
            elif d == "side":
                a[y0 + bh // 3:y0 + bh // 3 + 8, max(0, x0 - k):x0] = (180, 140, 90, 255)
            elif d == "down":
                a[y1:min(size, y1 + k), x0:x0 + 10] = (180, 140, 90, 255)
            elif d == "wing":
                a[y0:y0 + 10, max(0, x0 - k):x0] = (180, 140, 90, 255)
                a[y0:y0 + 10, x1:min(size, x1 + k)] = (180, 140, 90, 255)
        out.append(Image.fromarray(a))
    return out


def _delivered_body_height(frames, cell=256):
    import numpy as np

    hs = []
    for f in align_bottom_center(frames, cell=cell, cell_h=cell):
        a = np.asarray(f)
        m = (a[:, :, 0] > 150) & (a[:, :, 1] < 120) & (a[:, :, 3] > 128)
        ys, _ = np.where(m)
        hs.append(float(ys.max() - ys.min()) if len(ys) else 0.0)
    return float(np.median(hs))


# 四个体形族,每族内本体尺寸相同、只有延展物随动作变。
# **必须覆盖人形以外的体形** —— 现状那条宽度兜底的注释自己写着它是"人形先验",
# 当时为四足打了补丁,鸟和龙又漏了。
_FAMILIES = {
    "humanoid": (40, 110, [
        ("idle", ()),
        ("walk_cape", (("side", 40, True),)),
        ("raise_weapon", (("up", 50, False),)),
        ("run_cape_weapon", (("side", 50, True), ("up", 40, False))),
    ]),
    "quadruped": (110, 55, [
        ("idle_tail", (("up", 8, True),)),
        ("walk_tail", (("up", 30, True),)),
        ("run_tail_ears", (("up", 55, True),)),
        ("howl_tail_down", (("down", 40, False),)),
    ]),
    "bird": (50, 70, [
        ("perch", (("wing", 6, False),)),
        ("flap_small", (("wing", 35, True),)),
        ("wings_wide", (("wing", 70, True),)),
    ]),
    "dragon": (130, 50, [
        ("idle", (("down", 10, True),)),
        ("fly_long_tail", (("down", 60, True),)),
        ("wings_out", (("wing", 50, True),)),
    ]),
}


@pytest.mark.parametrize("family", sorted(_FAMILIES))
def test_body_size_is_stable_across_actions(family):
    """同一角色不同动作,交付帧里本体高度必须一致 —— 延展物不得影响定标。"""
    bw, bh, actions = _FAMILIES[family]
    got = {name: _delivered_body_height(_body(256, bw, bh, ext)) for name, ext in actions}
    base = got[actions[0][0]]
    for name, h in got.items():
        drift = abs(h - base) / base
        assert drift <= 0.02, (
            f"{family}/{name} 本体高 {h:.0f}px vs 基准 {base:.0f}px,偏差 {drift:.1%};"
            f" 全部: { {k: round(v) for k, v in got.items()} }"
        )


def test_core_span_ignores_extremities():
    """本体跨度只认厚薄,不认延展物的方向或语义。"""
    from windup_ai_engine.postprocess.pack import core_span

    plain = _body(256, 60, 90)[0]
    base_h, base_w = core_span(plain)
    for tag, ext in (("上举", ("up", 60, False)), ("侧展", ("side", 60, False)),
                     ("下垂", ("down", 60, False)), ("两翼", ("wing", 60, False))):
        h, w = core_span(_body(256, 60, 90, (ext,))[0])
        assert abs(h - base_h) <= 2 and abs(w - base_w) <= 2, (
            f"{tag}延展物影响了本体跨度: ({h},{w}) vs ({base_h},{base_w})")


def test_core_span_returns_none_for_empty_frame():
    from windup_ai_engine.postprocess.pack import core_span

    assert core_span(Image.new("RGBA", (32, 32), (0, 0, 0, 0))) is None


def test_size_is_kept_even_when_extremities_overflow():
    """延展物装不进画布时保尺寸,不为它压缩角色。

    两个目标冲突,后果不对称:压缩会让同一角色在两个动作间差到 4 成,溢出只丢翅尖那几列。
    """

    base = _delivered_body_height(_body(256, 50, 70))
    for wing in (20, 50, 80):
        src = _body(256, 50, 70, (("wing", wing, False),))
        got = _delivered_body_height(src)
        assert abs(got - base) / base <= 0.02, (
            f"翅展 {wing}px 时本体高 {got:.0f}px vs 基准 {base:.0f}px —— "
            "为装进画布压缩了角色")


def test_clipping_is_logged_not_silent(caplog):
    """选择让延展物溢出时必须上报 —— 丢像素不能靠人看图发现。"""
    import logging

    src = _body(256, 50, 70, (("wing", 80, False),))
    with caplog.at_level(logging.INFO, logger="windup_ai_engine.postprocess.pack"):
        align_bottom_center(src, cell=256, cell_h=256)
    assert any("溢出" in r.message for r in caplog.records), \
        f"裁切没有上报，日志：{[r.message for r in caplog.records]}"
