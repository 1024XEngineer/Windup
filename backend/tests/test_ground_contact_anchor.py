"""无地面接触的动作按躯干中心对齐(#534)。

这一片锁的是一种静默错误:飞行序列的包围盒底边是尾羽与爪子、逐帧在变,把底边钉死在
脚线上,身体反过来跟着延展物上下浮动 —— 而帧数、时长、成色、脚线 std 全部正常,
只有人盯着动图看才发现。

覆盖三段:① 几何(换锚点真的止住浮动,且不动定标);② 映射(jump 腾空但要回地,
不算无地面接触);③ 贯通(声明从 HTTP 入参一路走到对齐那一步,中间不许掉队)。
"""
from __future__ import annotations

import dataclasses
import io

import numpy as np
import pytest
from PIL import Image
from pydantic import ValidationError

from windup_ai_engine.impl import CharacterGenerator
from windup_ai_engine.postprocess.pack import (
    ANCHOR_CENTROID,
    ANCHOR_FOOT,
    FOOT_LINE,
    align_bottom_center,
    core_span,
)
from windup_ai_engine.strategy.base import DerivationStrategy, vertical_anchor
from windup_app.server.orchestrator.executor import ActionTaskExecutor, ProjectConstraints
from windup_app.server.orchestrator.model import ActionType as ApiActionType
from windup_app.server.orchestrator.model import CharacterActionInput
from windup_app.worker.handlers import _action_input
from windup_common.models import (
    ActionSpec,
    ActionType,
    CharacterCard,
    GenRoute,
    Stylize,
)

CELL = 256
REF_HEIGHT = 120.0        # 参考姿态高(生产由 _lastmile 按各帧包围盒中位数给)
_CORE = (200, 80, 80, 255)
_EXT = (180, 140, 90, 255)


def _flying(n: int = 12, size: int = 256, bw: int = 48, bh: int = 44, top: int = 90):
    """飞行序列:躯干在原帧里一动不动,尾羽与爪子逐帧伸缩。

    躯干不动是**故意**的 —— 交付帧里量到的任何纵向浮动都只能来自锚点选择,不掺姿态。
    """
    out = []
    for i in range(n):
        a = np.zeros((size, size, 4), np.uint8)
        x0 = (size - bw) // 2
        a[top:top + bh, x0:x0 + bw] = _CORE
        reach = int(4 + 22 * abs(np.sin(i / n * 2 * np.pi)))
        a[top + bh:top + bh + reach, x0 + 6:x0 + 10] = _EXT
        a[top + bh:top + bh + reach // 2, x0 + bw - 10:x0 + bw - 6] = _EXT
        out.append(Image.fromarray(a, "RGBA"))
    return out


def _walking(n: int = 12, size: int = 256, bw: int = 44, bh: int = 96):
    """有地面接触的序列:脚线钉在同一行,身高按步态自然起伏。"""
    out = []
    for i in range(n):
        a = np.zeros((size, size, 4), np.uint8)
        bob = i % 3
        x0, y1 = (size - bw) // 2, 200
        a[y1 - bh + bob:y1, x0:x0 + bw] = _CORE
        a[y1 - bh - 12:y1 - bh, x0 + 8:x0 + 12] = _EXT       # 举起的武器
        out.append(Image.fromarray(a, "RGBA"))
    return out


def _core_center(img: Image.Image) -> float:
    """交付帧里躯干的纵向中心。按颜色认躯干,免得又被延展物带走。"""
    a = np.asarray(img)
    m = (a[:, :, 0] > 150) & (a[:, :, 1] < 120) & (a[:, :, 3] > 128)
    ys, _ = np.where(m)
    return float(ys.min() + ys.max()) / 2


def _foot_ratio(img: Image.Image) -> float:
    a = np.asarray(img)[:, :, 3]
    ys, _ = np.where(a > 128)
    return (float(ys.max()) + 1) / img.size[1]


def _png(img: Image.Image) -> bytes:
    buf = io.BytesIO()
    img.save(buf, "PNG")
    return buf.getvalue()


def _custom(ground_contact=None, **kw) -> ActionSpec:
    kw.setdefault("n_frames", 8)
    kw.setdefault("stylize", Stylize.NONE)
    return ActionSpec(
        action=ActionType.CUSTOM,
        custom_action="flies forward with slow wing beats",
        cyclic=True,
        ground_contact=ground_contact,
        **kw,
    )


# ── ① 几何:换锚点止住浮动,定标一动不动 ────────────────────────────────────


def test_core_stops_bobbing_when_anchored_to_the_core():
    """验收①:同一条飞行序列,躯干中心的纵向 std 明显低于按脚线对齐。"""
    src = _flying()
    foot = [_core_center(f) for f in align_bottom_center(src, cell=CELL, ref_height=REF_HEIGHT)]
    core = [
        _core_center(f)
        for f in align_bottom_center(src, cell=CELL, ref_height=REF_HEIGHT, anchor=ANCHOR_CENTROID)
    ]
    foot_std, core_std = float(np.std(foot)), float(np.std(core))
    # 先验素材:脚线那档本来就该被延展物带着浮动,量不到说明这组帧根本没复现问题
    assert foot_std > 5.0, f"素材不成立:按脚线对齐也没浮动(std={foot_std:.2f})"
    assert core_std <= 1.0, (
        f"躯干仍在浮动:脚线 std={foot_std:.2f} → 质心 std={core_std:.2f};"
        f"逐帧中心 {[round(v, 1) for v in core]}"
    )


def test_grounded_frames_are_pixel_identical_to_the_default():
    """验收②:默认锚点一个像素都不许变。"""
    src = _walking()
    a = align_bottom_center(src, cell=CELL, ref_height=REF_HEIGHT)
    b = align_bottom_center(src, cell=CELL, ref_height=REF_HEIGHT, anchor=ANCHOR_FOOT)
    for x, y in zip(a, b, strict=True):
        assert np.array_equal(np.asarray(x), np.asarray(y))


def test_walking_still_lands_on_the_foot_line():
    """验收②的读数版:走路 / 待机的脚线仍落在 0.92。"""
    out = align_bottom_center(_walking(), cell=CELL, ref_height=REF_HEIGHT)
    feet = [_foot_ratio(f) for f in out]
    assert max(abs(v - FOOT_LINE) for v in feet) <= 0.01, feet


def test_switching_the_anchor_does_not_resize_the_character():
    """只换垂直锚点,不动 fill_h / ref_height 那套定标 —— 交付本体高必须一样。"""
    src = _flying()
    foot = align_bottom_center(src, cell=CELL, ref_height=REF_HEIGHT)
    core = align_bottom_center(src, cell=CELL, ref_height=REF_HEIGHT, anchor=ANCHOR_CENTROID)
    for a, b in zip(foot, core, strict=True):
        assert abs(core_span(a)[0] - core_span(b)[0]) <= 1


def test_unknown_anchor_raises_instead_of_falling_back():
    """拼错一个字母不静默回落到脚线:那正是本参数要修的错,而产出看起来完全正常。"""
    with pytest.raises(ValueError, match="anchor"):
        align_bottom_center(_flying(), cell=CELL, anchor="centroide")


def test_preserve_lift_and_the_core_anchor_are_mutually_exclusive():
    """质心对齐会把每帧摆到同一条线上,抬升量随之被抹平 —— 同开等于空操作。"""
    with pytest.raises(ValueError, match="preserve_lift"):
        align_bottom_center(_flying(), cell=CELL, preserve_lift=True, anchor=ANCHOR_CENTROID)


# ── ② 映射:哪些动作算无地面接触 ───────────────────────────────────────────


@pytest.mark.parametrize("action", [t for t in ActionType if t is not ActionType.CUSTOM])
def test_fixed_actions_all_keep_the_foot_anchor(action):
    assert vertical_anchor(ActionSpec(action=action)) == ANCHOR_FOOT


def test_jump_is_airborne_but_still_anchors_to_the_foot_line():
    """jump 腾空但要回地,与飞 / 游 / 攀不是一回事:按质心对齐会让落地帧悬在半空。"""
    assert vertical_anchor(ActionSpec(action=ActionType.JUMP)) == ANCHOR_FOOT


def test_custom_switches_only_when_the_caller_declares_no_ground_contact():
    assert vertical_anchor(_custom(ground_contact=False)) == ANCHOR_CENTROID
    assert vertical_anchor(_custom(ground_contact=True)) == ANCHOR_FOOT
    assert vertical_anchor(_custom()) == ANCHOR_FOOT


def test_fixed_actions_must_not_carry_ground_contact():
    """给 walk 传这个字段要炸:写死的动作都有地面接触,收下它等于让调用方以为能改。"""
    with pytest.raises(ValidationError, match="ground_contact"):
        ActionSpec(action=ActionType.WALK, ground_contact=False)


# ── ③ 贯通:声明从 HTTP 入参一路走到对齐 ────────────────────────────────────


class _FlyingStrategy(DerivationStrategy):
    """顶替真实 i2v:返回同一条飞行序列,让最后一公里真跑。"""

    route = GenRoute.VIDEO_I2V

    def derive(self, card, action, master, progress) -> list[bytes]:
        return [_png(f) for f in _flying(action.n_frames)]


class _NullProgress:
    def step(self, stage: str, i: int, total: int, note: str = "") -> None:
        pass


def _generate(action: ActionSpec) -> list[Image.Image]:
    gen = CharacterGenerator({GenRoute.VIDEO_I2V: _FlyingStrategy()})
    out = gen.generate(
        CharacterCard(name="鹰", desc="羽族斥候"),
        action,
        master=_png(_flying(1)[0]),
        progress=_NullProgress(),
    )
    return [Image.open(io.BytesIO(f)).convert("RGBA") for f in out.frames]


def test_engine_entrypoint_carries_the_declaration_into_the_last_mile():
    """只测 ``vertical_anchor`` 的话,``_lastmile`` 不把它传下去照样全绿。

    所以这条从引擎入口发起:同一组帧、同一条链,只有声明不同,量交付帧的躯干中心。
    """
    walk = [_core_center(f) for f in _generate(ActionSpec(action=ActionType.WALK, n_frames=8))]
    fly = [_core_center(f) for f in _generate(_custom(ground_contact=False))]
    assert float(np.std(walk)) > 5.0, "对照组不浮动的话这条用例证明不了任何事"
    assert float(np.std(fly)) <= 1.0, f"声明了无地面接触,躯干仍在浮动: {fly}"


class _Stop(Exception):
    """捕到 ActionSpec 就停,后面那些上传 / 记账与本条无关。"""


class _CaptureGenerator:
    def __init__(self) -> None:
        self.specs: list[ActionSpec] = []

    def generate(self, card, action, master, progress, canvas=None):
        self.specs.append(action)
        raise _Stop

    def generate_rendered(self, card, action, rigged_model, progress, canvas=None):
        raise AssertionError("没有 3D 资产却走了三渲二")


def _capture_spec(**input_kw) -> ActionSpec:
    gen = _CaptureGenerator()
    executor = ActionTaskExecutor(
        generator=gen,
        upload=lambda _png: "https://cdn.example.com/f.png",
        fetch_master=lambda _input: b"master-bytes",
        fetch_constraints=lambda *_: ProjectConstraints(sprite_w=64, sprite_h=64),
    )
    with pytest.raises(_Stop):
        executor._produce_action(
            CharacterActionInput(
                character_id=1,
                action_type=ApiActionType.CUSTOM,
                custom_prompt="flies forward",
                num_frames=4,
                **input_kw,
            ),
            ProjectConstraints(sprite_w=64, sprite_h=64),
            task_id=1,
        )
    return gen.specs[0]


def test_orchestrator_puts_the_declaration_on_the_action_spec():
    assert _capture_spec(ground_contact=False).ground_contact is False
    assert _capture_spec(ground_contact=True).ground_contact is True


def test_missing_declaration_falls_back_to_having_ground_contact():
    """不给按"有地面接触":误判成全程离地会让角色不站在地上,比浮动严重。"""
    assert _capture_spec().ground_contact is True


def test_worker_rebuilds_the_declaration_from_the_task_payload():
    """入参经 MQ 落库再取回 —— 生产就是这条路,漏在这里等于整条链恒走默认分支。"""
    src = CharacterActionInput(
        character_id=1,
        action_type=ApiActionType.CUSTOM,
        custom_prompt="flies forward",
        ground_contact=False,
    )
    assert _action_input(dataclasses.asdict(src)).ground_contact is False
