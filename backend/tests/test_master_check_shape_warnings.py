"""母版预检里**只警告不拒绝**的两条形态判据。

它们对着的是混元图生 3D 的硬约束(四肢要分得开、画面里不得有人体以外的组件),
而这两条约束违反了**不会报错,只会默默产出错结果** —— 与 ``providers.render3d.checks``
挡绑骨入口是同一个动作。区别在于:那一层量到就是事实,这一层量到的只是相关信号,
所以只能摆在母版确认闸上给人看,不能拿来挡路。

合成样本而不是真母版:真母版拿不到"只有腿粘连、其余一模一样"的对照,而这里要证明的
恰恰是**判据分得开这一对**。
"""
from __future__ import annotations

import io

import numpy as np
import pytest
from PIL import Image

from windup_ai_engine.master_check import (
    LIMB_BANDS,
    MIN_EXTRA_COMPONENT_RATIO,
    MIN_LIMB_RUN_PX,
    check_master,
    component_sizes,
    limb_segments,
)
from windup_ai_engine.ports import MasterWarningCode

INK = (40, 40, 60, 255)


def _figure(*, legs_apart: bool, prop: tuple[int, int, int, int] | None = None) -> bytes:
    """一个正面站立的火柴人。``legs_apart=False`` 时两腿之间的空隙被填死。

    除了那道空隙(和可选的道具),两张图逐像素相同 —— 判据要是分不开这一对,
    它量到的就不是"腿分没分开"。
    """
    img = Image.new("RGBA", (200, 400), (0, 0, 0, 0))
    draw = img.load()

    def block(x0: int, y0: int, x1: int, y1: int) -> None:
        for y in range(y0, y1):
            for x in range(x0, x1):
                draw[x, y] = INK

    block(80, 40, 120, 100)      # 头
    block(70, 100, 130, 240)     # 躯干
    block(40, 110, 70, 130)      # 左臂
    block(130, 110, 160, 130)    # 右臂
    block(74, 240, 94, 380)      # 左腿
    block(106, 240, 126, 380)    # 右腿
    if not legs_apart:
        block(94, 240, 106, 380)  # 把两腿之间的空隙填死
    if prop is not None:
        block(*prop)
    buf = io.BytesIO()
    img.save(buf, "PNG")
    return buf.getvalue()


def _codes(facts) -> set[MasterWarningCode]:
    return {w.code for w in facts.warnings}


# ── ① 四肢分离 ──────────────────────────────────────────────────────────────


def test_legs_apart_measures_two_segments_at_every_band():
    """双腿分离的人形:四处横切**每一处**都该量到 2 段。

    只断言"没警告"是不够的 —— 判据恒返回 2 时也没警告。要把量到的数按住。
    """
    facts = check_master(_figure(legs_apart=True))
    assert facts.limb_segments == (2, 2, 2, 2)
    assert MasterWarningCode.LIMBS_FUSED not in _codes(facts)


def test_fused_legs_drop_to_one_segment_and_warn():
    """空隙被填死后段数掉到 1,且必须出警告 —— 这正是绑骨分不出左右腿的形态。"""
    facts = check_master(_figure(legs_apart=False))
    assert facts.limb_segments == (1, 1, 1, 1)
    assert MasterWarningCode.LIMBS_FUSED in _codes(facts)


def test_fused_legs_are_warned_not_rejected():
    """**不能拒**:侧视角色两腿前后重叠时同样只有 1 段,而侧视正是本项目的主打。
    拒了就是拿一条必然误报的判据挡住用户的钱。"""
    facts = check_master(_figure(legs_apart=False))
    assert facts.subject_box                      # 走完了全程、返回了 facts
    assert facts.warnings                         # 只是带着警告回来


def test_one_occluded_band_does_not_trigger_the_warning():
    """裙摆/披风只遮住一处时不该报警 —— 判据取四处的最大值,不是每处都要 2 段。"""
    img = Image.open(io.BytesIO(_figure(legs_apart=True))).convert("RGBA")
    y = 40 + int(round(LIMB_BANDS[0] * (380 - 40 - 1)))   # 主体 y 跨 40..380
    for dy in range(-3, 4):                        # 只糊掉第一条带所在的几行
        for x in range(94, 106):
            img.putpixel((x, y + dy), INK)
    buf = io.BytesIO()
    img.save(buf, "PNG")
    facts = check_master(buf.getvalue())
    assert facts.limb_segments[0] == 1 and max(facts.limb_segments) == 2
    assert MasterWarningCode.LIMBS_FUSED not in _codes(facts)


def test_antialiasing_speckles_do_not_inflate_the_segment_count():
    """腿外侧的 1px 孤立像素不算一段。不滤掉的话一条腿会被数成三段,
    "粘连"反而被读成"更分离",判据方向整个反过来。"""
    mask = np.zeros((10, 40), dtype=bool)
    mask[:, 4] = True                              # 1px 宽的毛刺
    mask[:, 10:20] = True                          # 真正的一段
    assert limb_segments(mask, (0, 0, 40, 10)) == (1, 1, 1, 1)
    assert MIN_LIMB_RUN_PX > 1


# ── ② 主体之外的独立色块 ─────────────────────────────────────────────────────


def test_lone_figure_is_a_single_component():
    facts = check_master(_figure(legs_apart=True))
    assert len(facts.components) == 1
    assert MasterWarningCode.EXTRA_COMPONENT not in _codes(facts)


def test_detached_prop_is_reported_as_an_extra_component():
    """画面里多一把不挨着身体的剑 → 必须报出来:它会被一起建进网格再绑上权重。"""
    facts = check_master(_figure(legs_apart=True, prop=(170, 150, 180, 300)))
    assert len(facts.components) == 2
    assert MasterWarningCode.EXTRA_COMPONENT in _codes(facts)


def test_held_prop_touching_the_body_is_invisible_to_this_check():
    """**已知盲区,写成用例免得有人当它守住了**:道具与手臂相连时并成一块,零信号。"""
    facts = check_master(_figure(legs_apart=True, prop=(160, 110, 175, 300)))
    assert len(facts.components) == 1
    assert MasterWarningCode.EXTRA_COMPONENT not in _codes(facts)


def test_tiny_fragments_are_below_the_reporting_threshold():
    """抗锯齿碎片不该报警 —— 报警一多就没人看了。"""
    facts = check_master(_figure(legs_apart=True, prop=(180, 20, 183, 23)))
    assert len(facts.components) == 1
    assert MasterWarningCode.EXTRA_COMPONENT not in _codes(facts)
    assert 0 < MIN_EXTRA_COMPONENT_RATIO < 1


def test_components_are_eight_connected():
    """四邻接会把抗锯齿造成的对角细颈判成断开,同一条手臂被数成两块。"""
    mask = np.zeros((4, 4), dtype=bool)
    mask[0, 0] = mask[1, 1] = mask[2, 2] = True
    assert component_sizes(mask) == (3,)


def test_component_sizes_are_ordered_largest_first():
    mask = np.zeros((6, 20), dtype=bool)
    mask[1, 1:3] = True
    mask[1, 10:16] = True
    assert component_sizes(mask) == (6, 2)


# ── ③ 与既有拒绝码的分工 ─────────────────────────────────────────────────────


def test_a_detached_prop_cannot_silence_the_fused_legs_warning():
    """**两条判据不得互相架空。** 一把浮在腿侧的剑会在腿所在的那几行多贡献一段;
    若在整幅掩码上数腿,粘连的两腿就被凑够 2 段、警告消失 —— 母版越糟糕反而越安静。
    所以数腿只在最大连通块上做。"""
    facts = check_master(_figure(legs_apart=False, prop=(170, 240, 180, 380)))
    assert facts.limb_segments == (1, 1, 1, 1)
    assert _codes(facts) == {
        MasterWarningCode.LIMBS_FUSED,
        MasterWarningCode.EXTRA_COMPONENT,
    }
    assert all(w.detail for w in facts.warnings)


def test_note_mentions_warnings_so_progress_text_is_not_silently_clean():
    clean = check_master(_figure(legs_apart=True)).note()
    warned = check_master(_figure(legs_apart=False)).note()
    assert "警告" not in clean
    assert "警告" in warned


@pytest.mark.parametrize("frac", LIMB_BANDS)
def test_bands_all_sit_in_the_lower_body(frac: float):
    """带位必须都在下半身。挪到躯干上去的话,量到的是"腰有没有断开",与腿无关。"""
    assert 0.5 < frac < 1.0
