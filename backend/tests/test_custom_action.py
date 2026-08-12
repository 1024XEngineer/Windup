"""自定义动作生成(#239)。

这一片锁的核心不是"能跑通",而是三类**静默错误**:
  ① 用户写的动作描述**没进提示词**。今天它进的是 `CharacterCard.desc`,而视频路线一个
     card 字段都不读 —— 前端传了、后端收了、模型没看见,而帧数/时长/成色全部正常。
  ② 循环性**被猜**。"挥手"被当成循环 → 末帧接回首帧抽搐,同样没有任何一道会红。
  ③ 提示词骨架**被绕过**。若只把用户那句话丢给 i2v,会一次丢掉朝向锁、正向措辞、
     #195 的装备存在无关句、以及一次性动作的"只做一次+终态保持"。
"""
from __future__ import annotations

import io

import pytest
from PIL import Image
from pydantic import ValidationError

from windup_ai_engine.prompt import MAX_ACTION_CHARS, build_custom_prompt
from windup_ai_engine.strategy.base import ROUTE_MATRIX, is_cyclic
from windup_ai_engine.strategy.concrete import VideoFrameStrategy
from windup_common.models import ActionSpec, ActionType, CharacterCard, Facing, GenRoute, Stylize

# 装备名词黑名单,与 #195 那组回归测试同源:模板里出现任何一个都是在断言该物件存在。
_EQUIPMENT = (
    "cape", "tabard", "cloak", "robe", "scarf",
    "sword", "blade", "weapon", "shield", "axe", "spear",
    "boot", "armor", "armour", "helmet", "gauntlet",
)
# 否定式:这个 i2v 接口没有 negative_prompt,负面名词会被 latch 进画面。
_NEGATIONS = (" not ", " no ", "n't", "without", "avoid", "never")


def _png(shift: int = 0) -> bytes:
    """一张带主体的小 RGBA PNG。``shift`` 让相邻帧有位移,否则抽帧看到的是 N 张同一张图。"""
    im = Image.new("RGBA", (64, 96), (0, 0, 0, 0))
    for y in range(20, 80):
        for x in range(24 + shift, 40 + shift):
            im.putpixel((x, y), (200, 60, 60, 255))
    buf = io.BytesIO()
    im.save(buf, "PNG")
    return buf.getvalue()


class _NullProgress:
    def step(self, stage: str, i: int, total: int, note: str = "") -> None:
        pass


def _spec(action: str = "waves the right hand above the head", *, cyclic: bool = False, **kw):
    kw.setdefault("n_frames", 8)
    kw.setdefault("stylize", Stylize.NONE)
    return ActionSpec(action=ActionType.CUSTOM, custom_action=action, cyclic=cyclic, **kw)


# ── ① 契约:custom 必须自带动作描述与循环性 ────────────────────────────────


def test_custom_without_cyclic_is_rejected_at_construction():
    """不给循环性就炸,**不给默认值**。

    猜错的后果是"挥手被强行首尾闭环":末帧接回首帧抽搐,而帧数、时长、成色全部正常,
    没有任何一道会红 —— 正是本仓反复吃过的静默错误形态。
    """
    with pytest.raises(ValidationError, match="cyclic"):
        ActionSpec(action=ActionType.CUSTOM, custom_action="挥手")


def test_custom_without_description_is_rejected():
    with pytest.raises(ValidationError, match="custom_action"):
        ActionSpec(action=ActionType.CUSTOM, cyclic=False)


@pytest.mark.parametrize("blank", ["", "   ", "\n"])
def test_blank_description_is_rejected(blank):
    """空白描述不算给了 —— 否则等于付一次 i2v 的钱拿一段站着不动的视频。"""
    with pytest.raises(ValidationError):
        ActionSpec(action=ActionType.CUSTOM, custom_action=blank, cyclic=False)


@pytest.mark.parametrize("field", ["custom_action", "cyclic"])
def test_non_custom_actions_must_not_carry_custom_fields(field):
    """给 walk 传 cyclic 要炸,不能静默忽略。

    忽略的话调用方以为自己能覆盖 walk 的循环性,实际被写死的表覆盖 —— 又一个
    "看起来生效实则被忽略"。
    """
    val = "挥手" if field == "custom_action" else True
    with pytest.raises(ValidationError, match=field):
        ActionSpec(action=ActionType.WALK, **{field: val})


def test_custom_is_routed_to_video():
    assert ROUTE_MATRIX[ActionType.CUSTOM] is GenRoute.VIDEO_I2V


# ── ② 循环性:显式声明真的被用上 ───────────────────────────────────────────


def test_is_cyclic_follows_the_explicit_flag_for_custom():
    """custom 的循环性来自入参,不来自 CYCLIC_ACTIONS 那张表。

    直接判 `action.action in CYCLIC_ACTIONS` 对 CUSTOM 恒为 False,于是用户勾了
    "循环播放"也会被当一次性 —— 这条就是钉住那个错。
    """
    assert is_cyclic(_spec(cyclic=True)) is True
    assert is_cyclic(_spec(cyclic=False)) is False


def test_is_cyclic_still_reads_the_table_for_fixed_actions():
    assert is_cyclic(ActionSpec(action=ActionType.WALK)) is True
    assert is_cyclic(ActionSpec(action=ActionType.ATTACK)) is False


def _offline_strategy(monkeypatch, spy: list[str]):
    """离线 VideoFrameStrategy:抽帧被顶替,不联网不花钱;记下送进 i2v 的提示词。"""
    dense = [Image.open(io.BytesIO(_png(i % 6))).convert("RGBA") for i in range(24)]
    monkeypatch.setattr(
        "windup_ai_engine.strategy.concrete.extract_all_frames_bytes",
        lambda video, cap=150: dense,
    )

    class _SpyVideo:
        def i2v(self, first_frame, prompt, seconds=5, size="1280x720"):
            spy.append(prompt)
            return b"fake-mp4"

    class _Matte:
        def cutout(self, frame):
            return frame

    return VideoFrameStrategy(_SpyVideo(), _Matte())


def test_cyclic_flag_switches_the_slicing_mode(monkeypatch):
    """loop=true 走单周期闭环、loop=false 走裁区间 —— 两条分支的进度文案不同。

    只断言"两条都不抛错"验不出接反,所以断言分流后的实际行为。
    """
    seen: list[str] = []

    class _Spy:
        def step(self, stage, i, total, note=""):
            seen.append(note)

    spy: list[str] = []
    strat = _offline_strategy(monkeypatch, spy)
    card = CharacterCard(name="t", desc="t")

    strat.derive(card, _spec(cyclic=True), _png(), _Spy())
    assert any("无缝 loop" in n for n in seen), seen

    seen.clear()
    strat.derive(card, _spec(cyclic=False), _png(), _Spy())
    assert any("不闭环" in n for n in seen), seen


# ── ③ 用户描述必须真的进提示词(今天它进的是没人读的 card.desc)──────────────


def test_user_description_actually_reaches_the_i2v_prompt(monkeypatch):
    """这条是 #239 的核心缺口。

    今天 `custom_prompt` 被写进 `CharacterCard.desc`,而 `git grep 'card\\.'` 在 ai_engine
    下对视频路线零命中 —— 前端传了、后端收了、模型没看见。
    """
    spy: list[str] = []
    strat = _offline_strategy(monkeypatch, spy)
    strat.derive(
        CharacterCard(name="t", desc="这里写什么都不该影响产出"),
        _spec("spins once on the left heel with both arms out"),
        _png(), _NullProgress(),
    )
    assert spy, "没抓到送进 i2v 的提示词"
    assert "spins once on the left heel" in spy[0], spy[0]


def test_card_desc_still_does_not_leak_into_the_prompt(monkeypatch):
    """反向:card.desc 不该进提示词。身份由母版承载,再写一遍会和母版打架。"""
    spy: list[str] = []
    strat = _offline_strategy(monkeypatch, spy)
    strat.derive(
        CharacterCard(name="t", desc="ZZQUIRKYSENTINEL"),
        _spec("waves"), _png(), _NullProgress(),
    )
    assert "ZZQUIRKYSENTINEL" not in spy[0]


# ── ④ 骨架不能被绕过 ─────────────────────────────────────────────────────


@pytest.mark.parametrize("facing", [Facing.SIDE, Facing.FRONT])
@pytest.mark.parametrize("cyclic", [True, False])
def test_scaffolding_survives_any_user_text(facing, cyclic):
    """无论用户写什么,四项锁都必须在。

    这是自定义动作与"把用户输入直传模型"的唯一区别。
    """
    p = build_custom_prompt("挥手 and also wears a huge cape with a sword",
                            facing=facing, cyclic=cyclic)
    low = p.lower()
    # 朝向锁
    if facing is Facing.SIDE:
        assert "side view facing right" in low
    else:
        assert "facing the viewer" in low
    # 存在无关的衣饰/手持物保持句(#195)
    assert "whatever the character already wears" in low
    assert "anything held in the hands" in low
    # 循环性尾句
    assert ("repeating cycle" in low) if cyclic else ("ONCE" in p)


def test_scaffolding_never_asserts_equipment_even_if_the_user_does():
    """用户在描述里写了斗篷与剑,**骨架自己**仍不得断言装备。

    骨架只提供存在无关的保持句;用户那句话原样带过去是他的选择,但骨架不能替所有角色
    加上装备名词 —— 那就是 #195 的病(母版没有斗篷时模型会凭空长一件)。
    """
    p = build_custom_prompt("waves the right hand", facing=Facing.SIDE, cyclic=False)
    named = [w for w in _EQUIPMENT if w in p.lower()]
    assert not named, f"骨架里出现了装备名词: {named}"


def test_scaffolding_uses_only_positive_wording():
    """这个 i2v 接口没有 negative_prompt,否定式会被 latch 进画面。"""
    p = build_custom_prompt("waves the right hand", facing=Facing.SIDE, cyclic=False).lower()
    hits = [w for w in _NEGATIONS if w in p]
    assert not hits, f"骨架里出现否定式: {hits}"


def test_oneshot_says_once_and_holds_the_end_pose():
    """一次性动作不写"只做一次+终态保持"会在 5s 内复读第二次(实测)。"""
    p = build_custom_prompt("swings the right arm down", facing=Facing.SIDE, cyclic=False)
    assert "ONCE" in p
    assert "holds that pose" in p


def test_empty_and_overlong_descriptions_are_rejected():
    with pytest.raises(ValueError, match="不能为空"):
        build_custom_prompt("   ", facing=Facing.SIDE, cyclic=False)
    with pytest.raises(ValueError, match="超过上限"):
        build_custom_prompt("x" * (MAX_ACTION_CHARS + 1), facing=Facing.SIDE, cyclic=False)


def test_illegal_facing_raises_instead_of_falling_back():
    """朝向拼错要炸,别静默落到某一支(理由同 prompt.walk)。"""
    with pytest.raises(ValueError):
        build_custom_prompt("waves", facing="sidee", cyclic=False)


# ── ⑤ 视频模型可选 ───────────────────────────────────────────────────────


def test_only_the_three_opened_models_are_accepted():
    from windup_app.server.orchestrator.executor import (
        ALLOWED_VIDEO_MODELS,
        _resolve_video_model,
    )

    assert set(ALLOWED_VIDEO_MODELS) == {"kling-v2-5-turbo", "veo3.1", "kling-v2-6"}
    for name in ALLOWED_VIDEO_MODELS:
        assert _resolve_video_model(name) == name
    assert _resolve_video_model(None) is None, "None = 用部署默认值"


def test_unknown_model_fails_at_entry_not_at_the_paid_call():
    """非法模型名在入口炸。

    网关对没开通的模型返回的错误长得像"模型不存在",排查时容易怀疑错方向 ——
    宁可在入口用一条带可选值的消息挡掉。
    """
    from windup_app.server.orchestrator.executor import _resolve_video_model

    with pytest.raises(ValueError) as e:
        _resolve_video_model("sora-2")
    assert "kling-v2-5-turbo" in str(e.value), "报错要带上可选值,否则调用方无从改"


def test_generator_is_bucketed_by_video_model():
    """按模型分桶,否则第一个请求指定 veo3.1 之后所有请求都沿用它。

    模型是 provider 的构造参数,不能在已装好的 generator 上换 —— 不分桶就是
    "看起来指定了模型、实际用的是别人的"。
    """
    from windup_app.server.orchestrator.executor import ActionTaskExecutor

    ex = ActionTaskExecutor()
    a = ex._get_generator("kling-v2-6")
    b = ex._get_generator("veo3.1")
    assert a is not b, "两个模型拿到了同一个 generator"
    assert ex._get_generator("kling-v2-6") is a, "同一模型该复用"
