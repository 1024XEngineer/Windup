"""提示词门禁与适配器。

锁的是两类**静默**损失,不是"函数能跑":
  ① 措辞规则只写在文档里 → 随包发的提示词自己违反它,而生成照常成功、只是产物没法用;
  ② 用户那句大白话原样送进模型 → 报不了错,只在付完钱之后从画面上看出来。
所以门禁要真的跑在随包发的 md 上,适配器要在**调用付费模型之前**给出可执行的拒绝理由。
"""
from __future__ import annotations

import io

import pytest
from PIL import Image

from windup_ai_engine.ports import AdaptedPrompt, PromptRejectCode, PromptRejected
from windup_ai_engine.prompt._md import load_doc
from windup_ai_engine.prompt.adapter import _STANCE_PARTS, RuleBasedPromptAdapter
from windup_ai_engine.prompt.custom import CYCLIC_TAIL, MAX_ACTION_CHARS, ONESHOT_TAIL
from windup_ai_engine.prompt.lint import lint
from windup_ai_engine.strategy.concrete import VideoFrameStrategy
from windup_common.models import (
    ActionSpec,
    ActionType,
    CharacterCard,
    CharacterStance,
    Facing,
    Stylize,
)

# master_poses 是喂静态模型的母版姿态,其余四份是 i2v 正文 —— 规则的适用范围按机制分,
# 用错 kind 会让 2a/2b 对静态图误报。
SHIPPED = {
    "walk.md": "i2v", "jump.md": "i2v", "idle.md": "i2v",
    "attack.md": "i2v", "master_poses.md": "still",
}


def _errors(text: str, kind: str) -> list:
    return [i for i in lint(text, kind=kind) if i.level == "error"]


# ── ① 门禁跑在随包发的提示词上 ────────────────────────────────────────────


@pytest.mark.parametrize("doc", [d for d in SHIPPED if d != "attack.md"])
def test_shipped_prompts_pass_the_lint(doc: str):
    """除 attack 外,随包发的每一节都不许有 error 级问题。"""
    for section, text in load_doc(doc).items():
        if not text:                       # master_poses 里有意留空的节
            continue
        bad = _errors(text, SHIPPED[doc])
        assert not bad, f"{doc} `## {section}`: {[(i.category, i.term) for i in bad]}"


def test_attack_prompt_is_caught_on_equipment_shape_priors():
    """attack 正文里焊着刃面 / 弧线 / 前手 —— 母版里没有的形状会跟着这个角色走。

    这条是门禁的真实性检验:词表写不对,它就报不出这三个。
    """
    caught: set[str] = set()
    for section, text in load_doc("attack.md").items():
        caught |= {i.term for i in _errors(text, "i2v") if i.category == "shape_prior"}
    assert {"broad side", "crescent", "leading arm"} <= caught, caught


def test_lint_reports_the_mechanism_not_just_the_word():
    """报错要能让人照着改;"命中禁词"给不了任何改法。"""
    (issue,) = [i for i in lint("kicks up dust", kind="i2v") if i.category == "hazard_noun"]
    assert "dust" in issue.message
    assert len(issue.message) > 30, issue.message


# ── ② 适用范围按机制分 ───────────────────────────────────────────────────


def test_subthreshold_is_fatal_for_video_and_only_a_warning_for_stills():
    """低于可控分辨率的位移会逐帧随机抖 —— 静态图没有帧间,抖不起来。"""
    (v,) = [i for i in lint("slightly tilts the head", kind="i2v") if i.category == "subthreshold"]
    (s,) = [i for i in lint("slightly tilts the head", kind="still") if i.category == "subthreshold"]
    assert v.level == "error"
    assert s.level == "warn"


def test_unanchored_prop_is_not_checked_for_stills():
    """单件道具的素材图里根本没有身体,拿"身体锚"去要求它是无中生有。"""
    text = "holds the lantern out at arm length"
    assert [i for i in lint(text, kind="i2v") if i.category == "unanchored_prop"]
    assert not [i for i in lint(text, kind="still") if i.category == "unanchored_prop"]


def test_a_body_anchor_clears_the_prop_rule():
    """反向:交代了身体整体怎么动就不该再报 —— 否则这条规则等于禁止一切持物动作。"""
    text = "holds the lantern out while the torso leans forward"
    assert not [i for i in lint(text, kind="i2v") if i.category == "unanchored_prop"]


def test_upper_body_parts_do_not_count_as_a_body_anchor():
    """肩 / 肘随手持物一起漂,定不住整体;把它们算作锚会让 2b 形同虚设。"""
    assert [i for i in lint("holds the sword steady at the shoulder", kind="i2v")
            if i.category == "unanchored_prop"]


# ── ③ 适配器:拒绝要讲机制,且发生在花钱之前 ──────────────────────────────


def _adapt(
    text: str,
    *,
    kind: str = "i2v",
    facing: Facing = Facing.SIDE,
    stance: CharacterStance = CharacterStance.BIPED,
):
    return RuleBasedPromptAdapter().adapt(text, kind=kind, facing=facing, stance=stance)


def _reject(text: str, **kw) -> PromptRejected:
    with pytest.raises(PromptRejected) as e:
        _adapt(text, **kw)
    return e.value


# 每条拒绝理由 → 它的 code。server 据 code 选文案,所以"拒了"不够,拒对**哪一条**才算。
_REJECTIONS = [
    ("", "i2v", PromptRejectCode.EMPTY, "站着不动"),
    ("x" * (MAX_ACTION_CHARS + 1), "i2v", PromptRejectCode.TOO_LONG, str(MAX_ACTION_CHARS)),
    ("不要扬尘", "i2v", PromptRejectCode.NEGATION, "negative_prompt"),
    ("kicks up dust", "i2v", PromptRejectCode.HAZARD_NOUN, "轮廓"),
    ("swings with the broad side forward", "i2v", PromptRejectCode.SHAPE_PRIOR, "母版"),
    ("轻微抖动一下", "i2v", PromptRejectCode.SUBTHRESHOLD, "抖"),
    ("holds the sword steady at the shoulder", "i2v", PromptRejectCode.UNANCHORED_PROP, "漂"),
    ("蓄力后攻击再收势", "still", PromptRejectCode.MULTI_STAGE, "分解姿势"),
]


@pytest.mark.parametrize(("text", "kind", "code", "mechanism"), _REJECTIONS)
def test_each_rejection_carries_its_own_code_and_the_mechanism(text, kind, code, mechanism):
    """拒绝理由必须讲机制:用户拿到"提示词不合规"改不动,拿到"否定词只会被 latch 进画面"才改得动。"""
    rejected = _reject(text, kind=kind)
    assert rejected.code is code
    assert mechanism in rejected.detail, rejected.detail
    assert len(rejected.detail) > 30, rejected.detail


def test_every_reject_code_is_reachable():
    """枚举值不许只存在于定义里 —— 没有拒绝路径能产出的 code 是死值,server 却要为它写文案。"""
    covered = {c for _, _, c, _ in _REJECTIONS} | {PromptRejectCode.STANCE_MISMATCH}
    assert covered == set(PromptRejectCode)


def test_the_same_multi_stage_description_is_fine_for_video():
    """同一句话对 i2v 成立 —— 规则跟机制走,不跟文本走。"""
    assert _adapt("蓄力后攻击再收势", kind="i2v").text


def test_both_mechanisms_are_listed_when_two_rules_fire():
    """两条都命中时要把两条都讲出来,改完一条又被拦一次是最烦的;code 取报告序的第一条。"""
    rejected = _reject("不要扬尘")
    assert rejected.code is PromptRejectCode.NEGATION
    assert "不要" in rejected.detail and "扬尘" in rejected.detail


def test_impact_words_only_warn_and_still_produce_a_prompt():
    """冲击词是连带风险不是必然,拦下来的代价比放过去大。"""
    got = _adapt("slams the whole body onto the floor")
    assert [i for i in got.issues if i.category == "impact_verb"]


@pytest.mark.parametrize("stance", [s for s in CharacterStance if s is not CharacterStance.BIPED])
def test_non_biped_stance_rejects_human_limb_wording(stance):
    rejected = _reject("raises the left arm high", stance=stance)
    assert rejected.code is PromptRejectCode.STANCE_MISMATCH
    assert stance.value in rejected.detail
    assert _STANCE_PARTS[stance] in rejected.detail, "拒了却没告诉他改成哪个部位"


def test_every_non_biped_stance_brings_its_own_replacement_parts():
    """加一个体型却不给替换部位,拒绝理由就退回"这个词不行"。"""
    assert set(_STANCE_PARTS) == set(CharacterStance) - {CharacterStance.BIPED}


def test_biped_stance_keeps_the_same_wording():
    assert _adapt("raises the left arm high", stance=CharacterStance.BIPED).text


@pytest.mark.parametrize("blank", ["", "   ", "\n"])
def test_blank_text_is_rejected_instead_of_silently_producing_a_skeleton(blank):
    """空描述只会拿回一段站着不动的视频,而帧数和时长全对。"""
    assert _reject(blank).code is PromptRejectCode.EMPTY


def test_a_rejection_never_hands_back_a_prompt():
    """拒绝走异常而不是返回值:漏读一个 rejected 字段是静默的,漏 catch 不是。"""
    assert "rejected_reason" not in AdaptedPrompt.__dataclass_fields__


# ── ④ 适配器的产物本身要过得了门禁 ───────────────────────────────────────


@pytest.mark.parametrize("facing", [Facing.SIDE, Facing.FRONT])
@pytest.mark.parametrize("kind", ["i2v", "still"])
def test_adapted_output_carries_the_skeleton_and_passes_its_own_lint(facing, kind):
    got = _adapt("来回走动", kind=kind, facing=facing)
    assert "来回走动" in got.text, "用户那句话没进提示词"
    assert "whatever the character already wears" in got.text     # 装备存在无关
    assert "One single character alone in the frame" in got.text  # 单主体 + 构图
    assert not _errors(got.text, kind), _errors(got.text, kind)


def test_adapted_output_names_a_whole_body_anchor():
    """"来回走动"这类位移动作,骨架必须自己带上整体位移词,否则持物会漂。"""
    text = _adapt("来回走动").text
    assert any(w in text.lower() for w in ("whole body", "body", "torso", "hips"))


def test_still_output_demands_a_single_instant_and_video_output_does_not():
    """静态图要单一瞬间;i2v 反过来,写"一个瞬间"等于要一段静止视频。"""
    assert "ONE single frozen instant" in _adapt("来回走动", kind="still").text
    assert "frozen instant" not in _adapt("来回走动", kind="i2v").text


def test_video_output_leaves_the_loop_tail_to_the_caller():
    """循环性是请求的属性,适配器的入参里没有 —— 它替调用方猜一条就是静默出错。"""
    text = _adapt("来回走动", kind="i2v").text
    assert CYCLIC_TAIL not in text and ONESHOT_TAIL not in text


# ── ⑤ 接进管线:回退、拒绝、循环性 ───────────────────────────────────────


def _png() -> bytes:
    im = Image.new("RGBA", (64, 96), (0, 0, 0, 0))
    for y in range(20, 80):
        for x in range(24, 40):
            im.putpixel((x, y), (200, 60, 60, 255))
    buf = io.BytesIO()
    im.save(buf, "PNG")
    return buf.getvalue()


class _NullProgress:
    def step(self, stage: str, i: int, total: int, note: str = "") -> None:
        pass


class _SpyVideo:
    def __init__(self) -> None:
        self.prompts: list[str] = []

    def i2v(self, first_frame, prompt, seconds=5, size="1280x720"):
        self.prompts.append(prompt)
        return b"fake-mp4"


class _Matte:
    def cutout(self, frame):
        return frame


def _spec(action: str, *, cyclic: bool = False) -> ActionSpec:
    return ActionSpec(
        action=ActionType.CUSTOM, custom_action=action, cyclic=cyclic,
        n_frames=8, stylize=Stylize.NONE,
    )


def _offline(monkeypatch, adapter=None) -> tuple[VideoFrameStrategy, _SpyVideo]:
    dense = [Image.open(io.BytesIO(_png())).convert("RGBA") for _ in range(24)]
    monkeypatch.setattr(
        "windup_ai_engine.strategy.concrete.extract_all_frames_bytes",
        lambda video, cap=150: dense,
    )
    video = _SpyVideo()
    return VideoFrameStrategy(video, _Matte(), adapter), video


def test_the_prompt_that_reaches_the_model_went_through_the_adapter(monkeypatch):
    strat, video = _offline(monkeypatch)
    strat.derive(CharacterCard(name="t", desc="t"),
                 _spec("waves the right hand above the head"), _png(), _NullProgress())
    (sent,) = video.prompts
    assert "waves the right hand above the head" in sent
    assert "One single character alone in the frame" in sent, "适配器没接上"
    assert sent.endswith(ONESHOT_TAIL), "一次性动作丢了单次 + 终态保持"


def test_the_declared_loop_flag_still_picks_the_tail(monkeypatch):
    """适配器不碰循环性,但循环性必须仍然生效。"""
    strat, video = _offline(monkeypatch)
    card = CharacterCard(name="t", desc="t")
    strat.derive(card, _spec("来回走动", cyclic=True), _png(), _NullProgress())
    assert video.prompts[-1].endswith(CYCLIC_TAIL)


def test_a_rejected_description_never_reaches_the_paid_call(monkeypatch):
    """拒绝的全部价值在这一条:错在调用之前抛,而不是花完钱看画面。"""
    strat, video = _offline(monkeypatch)
    with pytest.raises(PromptRejected) as e:
        strat.derive(CharacterCard(name="t", desc="t"),
                     _spec("轻微抖动一下"), _png(), _NullProgress())
    # 类型和 code 都要穿到管线外:server 靠它们判 4xx 与选文案,靠 parse 消息的话
    # 改一次措辞就分支失效,而失效的表现是把用户的输入问题报成"系统出问题了"。
    assert e.value.code is PromptRejectCode.SUBTHRESHOLD
    assert video.prompts == [], "拒了还是把请求发了出去"


# ── ⑥ 体型从角色卡进到判定 ───────────────────────────────────────────────


class _StanceSpy:
    """记下真实收到的入参 —— 断言桩返回了什么证明不了管线传对了东西。"""

    def __init__(self) -> None:
        self.seen: list = []

    def adapt(self, user_text, *, kind, facing, stance):
        self.seen.append(stance)
        return AdaptedPrompt(text="ZZREWRITTEN")


@pytest.mark.parametrize("stance", list(CharacterStance))
def test_the_card_stance_is_what_the_adapter_receives(monkeypatch, stance):
    """写死 biped 时这条变红:非双足规则在真实管线里一次都不会生效。"""
    spy = _StanceSpy()
    strat, _ = _offline(monkeypatch, spy)
    strat.derive(CharacterCard(name="t", desc="t", stance=stance),
                 _spec("走两步"), _png(), _NullProgress())
    assert spy.seen == [stance]


def test_a_quadruped_card_rejects_human_limb_wording_end_to_end(monkeypatch):
    """规则 5 在真实管线里生效的唯一证据:走 derive、用真适配器、不碰付费调用。"""
    strat, video = _offline(monkeypatch)
    card = CharacterCard(name="t", desc="t", stance=CharacterStance.QUADRUPED)
    with pytest.raises(PromptRejected) as e:
        strat.derive(card, _spec("raises the left arm high"), _png(), _NullProgress())
    assert e.value.code is PromptRejectCode.STANCE_MISMATCH
    assert video.prompts == []


def test_the_same_wording_passes_for_the_default_biped_card(monkeypatch):
    """反向:默认体型不拦人体部位词,否则占多数的人形角色被逼着写"前肢"。"""
    strat, video = _offline(monkeypatch)
    strat.derive(CharacterCard(name="t", desc="t"),
                 _spec("raises the left arm high"), _png(), _NullProgress())
    assert "raises the left arm high" in video.prompts[0]


def test_a_broken_adapter_falls_back_to_the_existing_skeleton(monkeypatch):
    """新组件坏掉不许把整条生成打死 —— 骨架不依赖它。"""

    class _Boom:
        def adapt(self, user_text, *, kind, facing, stance):
            raise RuntimeError("模型服务挂了")

    strat, video = _offline(monkeypatch, _Boom())
    strat.derive(CharacterCard(name="t", desc="t"),
                 _spec("waves the right hand"), _png(), _NullProgress())
    (sent,) = video.prompts
    assert "waves the right hand" in sent
    assert "SIDE VIEW facing right" in sent      # 朝向锁还在
    assert sent.endswith(ONESHOT_TAIL)
    assert "One single character alone" not in sent, "坏掉的适配器不该还有产物"


def test_a_custom_adapter_can_replace_the_rule_based_one(monkeypatch):
    """协议是真的可替换的:换实现只换注入,管线零改动。"""

    class _Fixed:
        def adapt(self, user_text, *, kind, facing, stance):
            return AdaptedPrompt(text="ZZREWRITTEN")

    strat, video = _offline(monkeypatch, _Fixed())
    strat.derive(CharacterCard(name="t", desc="t"),
                 _spec("waves"), _png(), _NullProgress())
    assert video.prompts[0].startswith("ZZREWRITTEN")


def test_fixed_actions_are_untouched_by_the_adapter(monkeypatch):
    """只有 custom 的文本来自用户;walk 一类的正文是校准过的,不许被改写。"""
    strat, video = _offline(monkeypatch)
    strat.derive(CharacterCard(name="t", desc="t"),
                 ActionSpec(action=ActionType.WALK, n_frames=8, stylize=Stylize.NONE),
                 _png(), _NullProgress())
    assert "One single character alone" not in video.prompts[0]
