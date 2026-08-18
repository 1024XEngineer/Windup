"""跨层契约(windup_common.models.character)的类型约束。

本文件锁的不是"字段叫什么名"，而是**一类错误必须在构造 ActionSpec / CharacterCard 时就炸**：
朝向拼错、帧数字段名打错、规格自相矛盾。这些错误以前一路放行到 i2v 调用之后才在画面上显形，
一次误判的成本 = 一次付费视频生成 + 人肉看片。

契约本身的断言在 feat/character-domain-models 那一片,只测 DTO、不 import 上层包。
本分片引入 prompt 模块,于是把**实现侧**的配套断言补在这里:类型注解不是运行期约束,
``build_*(facing="sidee")`` 必须当场炸。契约合法不代表实现读对了。
"""
from __future__ import annotations

import inspect

import pytest
from pydantic import ValidationError

from windup_ai_engine.master_prep import ATTACK_MASTER_POSES, MASTER_POSES
from windup_ai_engine.prompt import (
    build_attack_prompt,
    build_idle_prompt,
    build_jump_prompt,
    build_walk_prompt,
)
from windup_ai_engine.strategy.concrete import VideoFrameStrategy
from windup_common.models import (
    DEFAULT_N_FRAMES,
    ActionSpec,
    ActionType,
    AttackArchetype,
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


def test_character_view_rejects_typos_and_matches_perspective_mapping():
    """view 固定映射 perspective：1 side / 2 top-down / 3 isometric。

    字符串必须逐字一致，免得将来做 int↔str 映射时出现
    topdown / top_down / top-down 三种写法。
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


# ── A1 实现侧:build_* 是普通函数，注解不构成运行期约束 ──────────────────────


@pytest.mark.parametrize(
    "build", [build_walk_prompt, build_jump_prompt, build_idle_prompt, build_attack_prompt]
)
def test_prompt_builders_reject_illegal_facing(build):
    """直接调 build_*(facing="sidee") 仍要炸。

    类型注解不是运行期约束。若把校验删成 ``SIDE if facing == Facing.SIDE else FRONT``
    的二分，"sidee" 会静默落到 FRONT 模板 —— 正面走的提示词配侧面母版，
    模型靠转身调和矛盾，而调用方什么错都收不到。
    """
    with pytest.raises(ValueError):
        build(facing="sidee")


@pytest.mark.parametrize(
    "build", [build_walk_prompt, build_jump_prompt, build_idle_prompt, build_attack_prompt]
)
def test_prompt_builders_accept_enum_and_legal_string_alike(build):
    assert build(facing=Facing.FRONT) == build(facing="front")
    assert build(facing=Facing.SIDE) == build(facing="side")


def test_walk_prompt_picks_the_template_that_matches_facing():
    """选模板的方向不能反 —— 只验"不炸"验不出模板接反。"""
    side = build_walk_prompt(facing=Facing.SIDE)
    front = build_walk_prompt(facing=Facing.FRONT)
    assert side != front
    # 不再断言 side == WALK_BODY_SIDE:那两个常量随 #233 删了,而且提示词搬进 md 之后
    # 那条断言是循环论证(两边读同一份文件的同一节,必然相等)。要测的是**方向没接反**,
    # 那就直接查朝向锁短语落在哪一条里。
    assert "SIDE VIEW facing right" in side and "SIDE VIEW facing right" not in front
    assert "FACING THE VIEWER" in front and "FACING THE VIEWER" not in side


@pytest.mark.parametrize("build", [build_jump_prompt, build_idle_prompt, build_attack_prompt])
def test_other_builders_also_switch_body_by_facing(build):
    assert build(facing=Facing.SIDE) != build(facing=Facing.FRONT)
    assert "FACING THE VIEWER" in build(facing=Facing.FRONT)


# ── A1.5 提示词只描述动作，不断言角色装备（#195）────────────────────────────

# 装备名词一旦进模板就是在断言该物件存在：母版没有斗篷，模型会为了满足文字凭空长一件，
# 母版真有的特征反被挤掉（2026-08-11 拿一个完全无布料的刚性角色实跑复现）。
# 这里连"角色确实持剑"的情形也一并禁掉——身份由母版承载，模板是所有角色共用的。
_EQUIPMENT_NOUNS = (
    "cape", "tabard", "cloak", "robe", "scarf",
    "sword", "blade", "weapon", "shield", "axe", "spear",
    "boot", "armor", "armour", "helmet", "gauntlet",
)


def _named_equipment(text: str) -> list[str]:
    low = text.lower()
    return [w for w in _EQUIPMENT_NOUNS if w in low]


@pytest.mark.parametrize(
    "build", [build_walk_prompt, build_jump_prompt, build_idle_prompt, build_attack_prompt]
)
@pytest.mark.parametrize("facing", [Facing.SIDE, Facing.FRONT])
def test_prompt_names_no_equipment(build, facing):
    """任一动作 × 任一朝向的正文里都不许出现装备名词。

    这条是 #195 的回归闸。**光验"参数能传"验不出这个 bug** —— 原先 garment/weapon
    确实是参数、确实能传，但零写入方，于是每个角色都吃到那个持剑披风原型的默认值。
    """
    named = _named_equipment(build(facing=facing))
    assert not named, f"{build.__name__}({facing}) 断言了装备: {named}"


def test_master_poses_name_no_equipment():
    """母版姿势描述同样不许写装备 —— 母版是整条 i2v 链的身份来源，污染会传到所有动作。"""
    poses = {**MASTER_POSES, **{a.value: t for a, t in ATTACK_MASTER_POSES.items()}}
    for action, pose in poses.items():
        named = _named_equipment(pose)
        assert not named, f"母版姿态 {action!r} 断言了装备: {named}"


@pytest.mark.parametrize(
    "build", [build_walk_prompt, build_jump_prompt, build_idle_prompt, build_attack_prompt]
)
def test_prompt_builders_expose_facing_only(build):
    """签名里只剩 facing。

    锁的是 #195 的**根因**而不只是症状：装备参数一旦以"有默认值的可选参数"形态存在，
    而调用侧（``strategy.concrete._build_prompt``）只传 facing，默认值就成了全体角色的
    实际取值。要按角色定制装备文字，得先有地方存它，那是角色卡契约的事；在这里留一个
    没人传的参数，只会让人以为该能力已经存在。

    attack 多一个 ``archetype``：它选的是运动拓扑(身体怎么发力)、取值是枚举、且真有写入方
    (``ActionSpec.archetype`` → ``_build_prompt``)，与"没人传的装备参数"不是一类。
    """
    allowed = ["facing", "archetype"] if build is build_attack_prompt else ["facing"]
    assert list(inspect.signature(build).parameters) == allowed


def test_attack_archetype_is_an_enum_not_free_text():
    """拼错的拓扑要当场炸,不能静默落到某一支 —— 理由同 facing 用枚举。"""
    p = inspect.signature(build_attack_prompt).parameters["archetype"]
    assert p.kind is inspect.Parameter.KEYWORD_ONLY, "archetype 必须是关键字参数,免得与 facing 传串位"
    assert p.default is AttackArchetype.THRUST
    with pytest.raises(ValueError):
        build_attack_prompt(facing=Facing.SIDE, archetype="swep")


def test_strategy_passes_only_facing_into_prompt_builders():
    """派生层确实只按朝向选模板，没有第二条把角色装备塞进提示词的通路。"""
    src = inspect.getsource(VideoFrameStrategy._build_prompt)
    for kw in ("garment", "weapon", "feet"):
        assert kw not in src, f"_build_prompt 又开始传 {kw} 了"


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
