"""跨层契约(windup_common.models.character)的类型约束。

本文件锁的不是"字段叫什么名"，而是**一类错误必须在构造 ActionSpec / CharacterCard 时就炸**：
朝向拼错、帧数字段名打错、规格自相矛盾。这些错误以前一路放行到 i2v 调用之后才在画面上显形，
一次误判的成本 = 一次付费视频生成 + 人肉看片。

本文件只测 DTO 自身,不 import 上层包 —— 契约包要能独立验证。配套的实现侧断言
("prompt 模板真的按 facing 选对"、"strategy 真的按 n_frames 出帧")随各自的实现
分片走,契约合法不代表实现读对了。
"""
from __future__ import annotations

import pytest
from pydantic import ValidationError

from windup_common.models import (
    DEFAULT_N_FRAMES,
    ActionSpec,
    ActionType,
    CharacterCard,
    CharacterView,
    Facing,
    Stylize,
)


# ── A1 受限取值:枚举，不是裸 str ────────────────────────────────────────────


@pytest.mark.parametrize("bad", ["Side", "sidee", "SIDE", "left", "", None, 1])
def test_facing_typo_is_rejected_at_construction(bad):
    """朝向拼错必须当场炸。

    这条约束的分量：facing 决定用侧走词还是正面走词，而"提示词朝向必须与母版朝向一致"
    是三次实测挣得的硬前提（见 ai_engine.master_prep）。裸 str 时代 "Side" 一路放行，
    要等 i2v 出片、人眼看到角色转身才发现。
    """
    with pytest.raises(ValidationError):
        ActionSpec(action=ActionType.WALK, facing=bad)


def test_legal_facing_string_is_coerced_to_enum_member():
    """合法字符串仍可传（旧调用方零改动），但落到模型里是枚举成员。"""
    spec = ActionSpec(action=ActionType.WALK, facing="front")
    assert spec.facing is Facing.FRONT
    assert ActionSpec(action=ActionType.WALK).facing is Facing.SIDE


@pytest.mark.parametrize(
    ("field", "bad", "good", "member"),
    [
        ("stylize", "pixels", "none", Stylize.NONE),
    ],
)
def test_action_spec_restricted_fields_reject_typos(field, bad, good, member):
    with pytest.raises(ValidationError):
        ActionSpec(action=ActionType.WALK, **{field: bad})
    assert getattr(ActionSpec(action=ActionType.WALK, **{field: good}), field) is member


def test_character_view_rejects_typos_and_matches_frontend_contract():
    """view 的取值与前端契约（frontend/API_CONTRACT.md：1 side / 2 top-down / 3 isometric）
    逐字一致，免得将来做 int↔str 映射时出现 topdown / top_down / top-down 三种写法。
    """
    assert {v.value for v in CharacterView} == {"side", "top-down", "isometric"}
    with pytest.raises(ValidationError):
        CharacterCard(name="n", desc="d", view="topdown")   # 少了连字符
    assert CharacterCard(name="n", desc="d", view="top-down").view is CharacterView.TOP_DOWN


def test_character_card_default_view_is_a_legal_value():
    """默认值必须落在自己的取值集合里。

    改枚举前的默认是 ``view = "pseudo-side"`` —— 它连自己行尾注释写的
    "side / topdown / isometric" 都不在其中。任何 ``if card.view == "side"`` 的消费方
    对每一个默认构造的角色卡都会走错分支，且不会有任何报错。
    """
    assert CharacterCard(name="n", desc="d").view in set(CharacterView)


def test_unknown_field_name_is_rejected_not_silently_dropped():
    """字段名打错要炸。pydantic 默认 extra="ignore" 会静默吞掉。

    ``n_frame``（少个 s）在 ignore 下的后果和 facing 拼错同级：不报错、不生效，
    调用方以为点了 16 帧，实际拿到默认 8 帧的成片。
    """
    with pytest.raises(ValidationError):
        ActionSpec(action=ActionType.WALK, n_frame=16)
    with pytest.raises(ValidationError):
        CharacterCard(name="n", desc="d", nmae="typo")


# ── A2 n_frames 是显式字段，不再由 len(poses) 推导 ──────────────────────────


def test_n_frames_is_explicit_and_needs_no_dummy_poses():
    """要 16 帧就写 16 —— 不必编 16 条视频路线根本不读的姿势描述。"""
    spec = ActionSpec(action=ActionType.WALK, n_frames=16)
    assert spec.n_frames == 16
    assert spec.poses == []


def test_n_frames_defaults_to_the_contract_default():
    assert ActionSpec(action=ActionType.WALK).n_frames == DEFAULT_N_FRAMES == 8


def test_n_frames_falls_back_to_len_poses_for_old_callers():
    """旧调用方只传 poses 时行为不变（兼容),包括显式传 None。"""
    assert ActionSpec(action=ActionType.HIT, poses=["a", "b", "c"]).n_frames == 3
    assert ActionSpec(action=ActionType.HIT, poses=["a", "b"], n_frames=None).n_frames == 2


def test_n_frames_and_poses_may_agree():
    assert ActionSpec(action=ActionType.HIT, poses=["a", "b"], n_frames=2).n_frames == 2


def test_conflicting_n_frames_and_poses_raises_instead_of_picking_one():
    """规格自相矛盾时炸掉，不猜。

    common 层看不到 ROUTE_MATRIX（分层约束），判不出这条 spec 走视频还是逐帧，
    因此"哪个字段说了算"无从判定。猜一个的代价是静默出错帧数的成片。
    """
    with pytest.raises(ValidationError, match="n_frames"):
        ActionSpec(action=ActionType.HIT, poses=["a", "b"], n_frames=16)


@pytest.mark.parametrize("bad", [0, -1])
def test_n_frames_must_be_at_least_one(bad):
    """0 帧的 spec 不能进管线：付一次视频的钱、抽 0 帧、产出一个空动作。"""
    with pytest.raises(ValidationError):
        ActionSpec(action=ActionType.WALK, n_frames=bad)


def test_explicit_none_means_unspecified_with_or_without_poses():
    """``n_frames=None`` 两条分支行为一致 —— 都当"没指定"。

    调用方常写 ``n_frames=payload.get("n_frames")``。修之前：有 poses 时 None 回退到
    len(poses)，没 poses 时 None 撞上 ``n_frames: int`` 直接 ValidationError ——
    同一个"未指定"在两种上下文里一个能用一个报错。
    """
    assert ActionSpec(action=ActionType.WALK, n_frames=None).n_frames == DEFAULT_N_FRAMES
    assert ActionSpec(action=ActionType.HIT, poses=["a", "b"], n_frames=None).n_frames == 2


def test_json_string_n_frames_agreeing_with_poses_is_not_a_conflict():
    """JSON 入参里 n_frames 是字符串 "2"、poses 两条 —— 这是一致的，不该报打架。

    修之前 before 校验器在 pydantic 收敛类型之前直接 ``"2" != 2``，于是抛出自相矛盾的
    「n_frames=2 与 len(poses)=2 不一致」，把一次合法请求判成非法（2026-08-08 实测）。
    """
    spec = ActionSpec.model_validate({"action": "hit", "poses": ["a", "b"], "n_frames": "2"})
    assert spec.n_frames == 2


def test_json_string_n_frames_conflicting_with_poses_still_raises():
    """收敛类型不等于放过打架 —— "16" vs 2 条 poses 仍要炸。"""
    with pytest.raises(ValidationError, match="n_frames"):
        ActionSpec.model_validate({"action": "hit", "poses": ["a", "b"], "n_frames": "16"})


@pytest.mark.parametrize(
    "payload",
    [
        {"action": "walk", "n_frames": None},          # 走删键分支(_without)
        {"action": "walk", "poses": ["a", "b"]},       # 走补键分支
        {"action": "walk", "poses": ["a"], "n_frames": 1},
    ],
)
def test_validator_does_not_mutate_the_callers_payload(payload):
    """before 校验器拿到的是调用方那个 dict 本体，原地改它会污染调用方的数据。

    三个入参分别覆盖校验器的三条出口 —— 只测一条会漏:最初这里只传了 poses 那一条,
    于是"删键分支改成原地 pop"的变异全绿通过(2026-08-08 变异验证抓到)。
    """
    before = {k: (list(v) if isinstance(v, list) else v) for k, v in payload.items()}
    ActionSpec.model_validate(payload)
    assert payload == before


# ── 取值域:实现里已有的下界写进契约，别让实现悄悄纠正入参 ────────────────────


@pytest.mark.parametrize(
    ("field", "bad"),
    [
        ("fps", 0), ("fps", -1),          # 播放侧的除数，0 无合法语义
        ("pixel_h", 0),                   # postprocess.to_pixel_art 对 <1 本就 raise
        ("palette_size", 1),              # quantize(colors=max(2, …)) 会把 1 静默抬成 2
    ],
)
def test_numeric_fields_reject_values_the_implementation_would_silently_fix(field, bad):
    with pytest.raises(ValidationError):
        ActionSpec(action=ActionType.WALK, **{field: bad})




# ── A3 palette 已删除 ───────────────────────────────────────────────────────


def test_character_card_has_no_palette_field():
    """``palette: str`` 已删（2026-08-08）。

    删而不是"定清格式"的理由：真正锁色的色板由 postprocess.master_pixel_spec 从母版像素里
    量出来（ndarray → _snap_to_palette），角色卡上再挂一个自由 str 就是同一件事的第二真相源，
    而且是更弱的那个 —— 零消费方。调用方填 "#1a1a2e,#e94560" 期待锁色，管线照旧用母版色板，
    不报错也不生效，正是本项目最忌讳的"看起来成功的错结果"。
    """
    assert "palette" not in CharacterCard.model_fields


def test_passing_palette_now_fails_loudly():
    """删字段要让旧调用方听得见响 —— extra="forbid" 保证它不是被静默丢弃。"""
    with pytest.raises(ValidationError):
        CharacterCard(name="n", desc="d", palette="#1a1a2e,#e94560")


# ── A4 fps 与 loop 已删除（2026-08-10，机器审 P2）─────────────────────────────


def test_action_spec_has_no_fps_or_loop_field():
    """两个字段都是"接了不履约"的入参，删而不是留着加注释。

    - ``fps``：零写入方（编排层构造 ActionSpec 时从不传），而 postprocess.frame_durations
      按动作查表、根本不看它。留着的后果是同一段素材有两个互相矛盾的播放速度：
      ``fps=20`` 宣称 50ms/帧，walk 实际给 125ms/帧。播放时序的唯一真相源是出参的
      ``durations``。
    - ``loop``：零消费方。闭环行为写死在 slicing.pick_cycle —— 循环类动作一律抽单周期
      闭环，传 pingpong / none 不改变任何产出。调用方能为一段往返动画付费、拿到一段
      线性循环，正是本项目最忌讳的"静默成功"。

    与 palette 那两条同一条理由：没有实现的取值等于死代码，它让调用方以为该能力存在。
    """
    assert "fps" not in ActionSpec.model_fields
    assert "loop" not in ActionSpec.model_fields


@pytest.mark.parametrize(("field", "value"), [("fps", 20), ("loop", "pingpong")])
def test_passing_fps_or_loop_now_fails_loudly(field, value):
    """删字段要让旧调用方听得见响 —— extra="forbid" 保证不是被静默丢弃。"""
    with pytest.raises(ValidationError):
        ActionSpec(action=ActionType.WALK, **{field: value})


def test_loop_mode_enum_is_gone_from_the_public_surface():
    """枚举本身也要删：留着它，下一个人会以为只是暂时没接线而照着填。

    真要支持 pingpong，连同 pick_cycle 的分支与出参时序契约一起加回。
    """
    import windup_common.models as m

    assert not hasattr(m, "LoopMode")
    assert "LoopMode" not in m.__all__
