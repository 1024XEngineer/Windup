"""母版入口预检 + 出参成色信号。

两头各一道闸，方向相反：进门那道在**花钱之前**挡住不可能生成好的输入；
出门那道在钱已花完之后，让上层看得出"这次生成得怎么样"。

2026-08-07 的教训：喂一张"人物在画板前作画"的图请求 walk，全程无一处报错，
16 帧构图完整的错角色出完、钱花完。而一段每帧都一样的 walk 与一段步态干净的 walk，
帧数 / 时长 / fps 完全相同，调用方分辨不出。
"""
from __future__ import annotations

import io

import pytest
from PIL import Image

from windup_ai_engine.master_check import (
    MIN_SUBJECT_SIDE,
    REJECT_ASPECT,
    check_master,
    reject_aspect_for,
)
from windup_ai_engine.ports import ActionQuality, MasterRejectCode, MasterRejected
from windup_ai_engine.slicing import dead_frame_indices, loop_seam, motion_scale
from windup_ai_engine.postprocess.pack import FILL_H, FILL_W


def _png(w: int, h: int, blob: tuple[tuple[int, int, int, int], tuple] | None = None,
         bg=(0, 0, 0, 0)) -> bytes:
    img = Image.new("RGBA", (w, h), bg)
    if blob:
        (x0, y0, x1, y1), color = blob
        for y in range(y0, y1):
            for x in range(x0, x1):
                img.putpixel((x, y), color)
    buf = io.BytesIO()
    img.save(buf, "PNG")
    return buf.getvalue()


# ── 入口预检：四种拒绝码 ──────────────────────────────────────────────────────


def test_undecodable_bytes_rejected_before_spending():
    """坏 bytes 直接炸，不要等 i2v 花完钱才发现输入根本不是图。"""
    with pytest.raises(MasterRejected) as e:
        check_master(b"not an image at all")
    assert e.value.code is MasterRejectCode.UNDECODABLE


def test_fully_transparent_has_no_subject():
    with pytest.raises(MasterRejected) as e:
        check_master(_png(200, 200))
    assert e.value.code is MasterRejectCode.NO_SUBJECT


def test_flat_single_color_has_no_subject():
    """全同色 = 没有可动的东西。不透明但一片死板的图同样该拒。"""
    with pytest.raises(MasterRejected) as e:
        check_master(_png(200, 200, bg=(120, 90, 60, 255)))
    assert e.value.code is MasterRejectCode.NO_SUBJECT


def test_subject_smaller_than_min_side_rejected():
    """包围盒最短边不足 → 下游会把它 NEAREST 放大 20 倍，那是色块不是角色。

    刻意用**细长条**而不是小方块：细长条的像素占比高达 1.3%（远超 0.1% 下限），
    所以占比那条拦不住它，只有最短边这条能拦。用小方块的话两条判据都会触发，
    删掉任何一条测试都照样绿——那种测试等于没写（2026-08-09 变异测试逮到）。
    """
    thin = MIN_SUBJECT_SIDE - 2                       # 6px 宽
    with pytest.raises(MasterRejected) as e:
        check_master(_png(300, 300, blob=((100, 40, 100 + thin, 240), (200, 60, 60, 255))))
    assert e.value.code is MasterRejectCode.SUBJECT_TOO_SMALL


def test_scattered_specks_pass_side_check_but_fail_area_ratio():
    """对角两粒噪点会把包围盒撑到整幅——边长检查全过，占比才拦得住。

    这两条判的不是同一件事，缺了占比这条，一张几乎空白的图会被判成"有主体"。
    """
    # 每粒 10×10=100px（边长过得了 MIN_SUBJECT_SIDE=8），两粒共 200px，
    # 占 600×600 的 0.056%，压在 0.1% 下限之下；而包围盒被撑到 ~590×590，边长检查全过。
    img = Image.new("RGBA", (600, 600), (0, 0, 0, 0))
    for (x, y) in ((8, 8), (582, 582)):
        for dy in range(10):
            for dx in range(10):
                img.putpixel((x + dx, y + dy), (200, 60, 60, 255))
    buf = io.BytesIO()
    img.save(buf, "PNG")
    with pytest.raises(MasterRejected) as e:
        check_master(buf.getvalue())
    assert e.value.code is MasterRejectCode.SUBJECT_TOO_SMALL


def test_extremely_wide_subject_rejected():
    """主体太扁 → 方形画布只能把角色硬缩成一条，不如在花钱前退回去。"""
    w = int(60 * REJECT_ASPECT) + 40
    with pytest.raises(MasterRejected) as e:
        check_master(_png(w + 40, 200, blob=((10, 60, 10 + w, 120), (200, 60, 60, 255))))
    assert e.value.code is MasterRejectCode.ASPECT_TOO_WIDE


def test_ordinary_humanoid_master_passes_and_reports_facts():
    """人形母版必须放行——预检的价值在于不误伤，误伤一次比漏放一次更贵。"""
    facts = check_master(_png(400, 600, blob=((160, 100, 240, 520), (200, 60, 60, 255))))
    assert facts.size == (400, 600)
    assert 0.1 < facts.subject_ratio < 1.2
    assert facts.subject_area_ratio > 0.001
    assert facts.note()          # 进度文案不能是空串


def test_reject_aspect_is_derived_from_canvas_geometry_not_hardcoded():
    """阈值必须跟着画布几何走。把 pack.py 的 FILL_W/FILL_H 改了而这里不动，
    预检就会放行一批下游装不下的母版——那正是"看起来成功"的来源。"""
    assert REJECT_ASPECT == pytest.approx(2 * FILL_W / FILL_H)


# ── 非方形交付画布下的比例上限(2026-08-11 挣得)────────────────────────────
#
# REJECT_ASPECT 的推导默认画布是方形(FILL_W / FILL_H 是同一条边长的两个比例)。
# 交付画布可以非方之后前提不再成立:同一条推导做下来是 REJECT_ASPECT*(cw/ch)。
# 不跟着收的后果是预检按方形判、出帧按非方出 —— 一个刚好过检的主体在 384×512
# 画布上交付占高只有 0.2324,而这条阈值本意保证的下限是 FILL_H/2=0.31(实测)。


def test_reject_aspect_for_square_canvas_is_unchanged():
    """方形画布(以及不指定)必须与原来完全一致 —— 默认行为不变。"""
    assert reject_aspect_for(None) == REJECT_ASPECT
    for c in (128, 256, 512, 1024):
        assert abs(reject_aspect_for((c, c)) - REJECT_ASPECT) < 1e-12


def test_reject_aspect_for_narrow_canvas_tightens_proportionally():
    """窄高画布容得下的主体更窄,阈值按 cw/ch 收紧;宽扁画布反之放宽。"""
    assert reject_aspect_for((384, 512)) < REJECT_ASPECT
    assert reject_aspect_for((512, 384)) > REJECT_ASPECT
    assert abs(reject_aspect_for((384, 512)) - REJECT_ASPECT * 384 / 512) < 1e-12


def test_threshold_delivers_exactly_half_target_height_on_any_canvas():
    """**预检几何与出帧几何是同一套**的直接证据。

    阈值的定义就是交付主体高退化到目标高度的一半。拿真实出帧验证:处在各自比例
    上限的主体,在任何形状的画布上交付占高都必须落在 FILL_H/2 附近(差的是取整)。
    """
    import numpy as np

    from windup_ai_engine.postprocess.pack import align_bottom_center

    for cw, ch in ((256, 256), (512, 512), (384, 512), (512, 384), (128, 192)):
        limit = reject_aspect_for((cw, ch))
        base_h, src_w = 200, 3000        # 源画幅给足,别让主体被源边界裁掉
        blob_w = int(base_h * limit)
        img = Image.new("RGBA", (src_w, 600), (0, 0, 0, 0))
        img.paste((200, 60, 60, 255), (100, 100, 100 + blob_w, 100 + base_h))
        out = align_bottom_center([img], cell=cw, cell_h=ch, ref_height=float(base_h))
        ys, _ = np.nonzero(np.asarray(out[0])[:, :, 3] > 128)
        ratio = (int(ys.max()) - int(ys.min()) + 1) / ch
        assert abs(ratio - FILL_H / 2) < 0.01, (
            f"{cw}×{ch}: 阈值处交付占高 {ratio:.4f},应为 {FILL_H / 2}"
        )


def test_check_master_uses_the_canvas_it_is_given():
    """同一张母版:方形画布放行,窄高画布上超限 → 必须被拒。"""
    ratio = (REJECT_ASPECT + reject_aspect_for((384, 512))) / 2   # 夹在两个阈值中间
    bw = int(60 * ratio)
    png = _png(bw + 80, 200, blob=((10, 60, 10 + bw, 120), (200, 60, 60, 255)))

    check_master(png, canvas=(512, 512))        # 方形:放行
    with pytest.raises(MasterRejected) as e:
        check_master(png, canvas=(384, 512))    # 窄高:同一张图装不下
    assert e.value.code is MasterRejectCode.ASPECT_TOO_WIDE


def test_rejection_carries_machine_readable_code_not_just_a_message():
    """server 要据此选文案 / 决定 4xx-不重试，用消息做分支会在改文案时悄悄失效。"""
    with pytest.raises(MasterRejected) as e:
        check_master(b"broken")
    assert isinstance(e.value.code, MasterRejectCode)
    assert e.value.detail


# ── 出参成色：三个字段各自不可由其他两个推导 ──────────────────────────────────


def _frames(n: int, shift: int = 3) -> list[Image.Image]:
    out = []
    for i in range(n):
        im = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
        x = 10 + (i * shift) % 30
        for y in range(20, 50):
            for xx in range(x, x + 12):
                im.putpixel((xx, y), (200, 60, 60, 255))
        out.append(im)
    return out


def test_motion_scale_is_zero_for_a_frozen_sequence():
    """整段冻结时死帧判据一帧都报不出——两条判据都是相对的，d 全为 0 时
    `0 < 0` 一条都不成立。绝对尺度必须单独给一个，否则"每帧都一样"这种
    最典型的坏产出在出参上完全看不见。"""
    same = _frames(12, shift=0)
    assert motion_scale(same) == 0.0
    assert len(dead_frame_indices(same)) == 0, "相对判据看不见整体没动 —— 正是要 motion_scale 的原因"


def test_motion_scale_positive_for_real_movement():
    assert motion_scale(_frames(12)) > 0.0


def test_dead_frame_indices_returns_positions_not_a_mask():
    """跨出 ai_engine 的契约要"哪几帧"，不该让调用方拿 numpy 掩码去 argwhere。"""
    idx = dead_frame_indices(_frames(10))
    assert isinstance(idx, tuple)
    assert all(isinstance(i, int) for i in idx)


def test_loop_seam_returns_none_when_there_is_no_step_to_compare():
    """分母为 0 时返回 None 而不是 0.0——0.0 会被读成"完美闭环"，
    而真相是"没有可比的步长，这个数不可读"。"""
    assert loop_seam(_frames(8, shift=0)) is None
    assert loop_seam(_frames(1)) is None


def test_loop_seam_measures_the_gap_between_last_and_first():
    seam = loop_seam(_frames(10))
    assert seam is not None and seam >= 0.0


def test_quality_fields_are_independent():
    """三个字段互不可推导：全同帧的 motion_scale=0 而 dead_frames 为空，
    两者若能互推，这一组断言不可能同时成立。"""
    q = ActionQuality(motion_scale=0.0, dead_frames=(), loop_seam=None)
    assert q.motion_scale == 0.0 and q.dead_frames == () and q.loop_seam is None


# ── 分区动量:整幅指标的盲区 ──────────────────────────────────────────────


def test_limb_motion_catches_a_frozen_region_that_whole_frame_metrics_miss():
    """一半肢体冻着、另一半在动 —— motion_scale 与死帧全部正常,只有分区动量看得见。

    这是自动绑骨漏认一条肢体的典型产物:那块网格没有骨骼驱动,每帧同姿势。
    """
    from windup_ai_engine.slicing.quality import (
        dead_frame_indices,
        limb_motion,
        motion_scale,
    )

    # 左半永远不变,右半逐帧移动
    frames = []
    for i in range(12):
        im = Image.new("RGBA", (64, 96), (0, 0, 0, 0))
        for y in range(20, 80):
            for x in range(8, 24):                     # 左半:固定
                im.putpixel((x, y), (200, 60, 60, 255))
            for x in range(40 + (i % 4), 52 + (i % 4)):  # 右半:动
                im.putpixel((x, y), (60, 60, 200, 255))
        frames.append(im)

    assert motion_scale(frames) > 0.5, "整幅指标应当认为这段在动"
    assert len(dead_frame_indices(frames)) < len(frames) // 2, "整幅判据也不会报成死帧"

    lm = limb_motion(frames)
    left = [v for k, v in lm.items() if k.endswith("左") and isinstance(v, float)]
    right = [v for k, v in lm.items() if k.endswith("右") and isinstance(v, float)]
    assert max(left) < 0.02, f"冻结的左半占比应当接近 0,实际 {left}"
    assert min(right) > 0.1, f"在动的右半占比应当显著为正,实际 {right}"
    assert "左" in lm["still"], f"最静区应当在左半,实际 {lm['still']}"


def test_limb_motion_summary_keys_are_not_mistaken_for_regions():
    """``still`` 只能指向真实分区,不能挑中自己。

    把汇总键写进字典后才算最小值的话,它(值通常比任何区都小)会被挑成"最静区",
    报出一个不存在的区名 —— 一个只在数据上体现、不会报错的错。顺带钉住占比归一。
    """
    from windup_ai_engine.slicing.quality import limb_motion

    frames = [Image.new("RGBA", (64, 96), (0, 0, 0, 0)) for _ in range(4)]
    for i, im in enumerate(frames):
        for y in range(20, 80):
            for x in range(10 + i, 30 + i):
                im.putpixel((x, y), (200, 60, 60, 255))
    lm = limb_motion(frames)
    assert lm["still"] != "still", f"still 挑中了汇总键:{lm['still']}"
    assert lm["still"] in lm and isinstance(lm[lm["still"]], float)
    shares = [v for k, v in lm.items() if k != "still"]
    # 容差取舍入精度:各区各自 round 到 3 位,6 个区最多累积 6×0.0005 的误差。
    # 不写 1e-6 —— 那样断言的是"没做舍入",而不是"归一化对了"。
    assert abs(sum(shares) - 1.0) < 0.01, f"各区占比应当归一,实际和 {sum(shares)}"
