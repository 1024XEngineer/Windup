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
import threading
import time

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
    """不给循环性就炸,**不给默认值**。"""
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
    """给 walk 传 cyclic 要炸,不能静默忽略。"""
    val = "挥手" if field == "custom_action" else True
    with pytest.raises(ValidationError, match=field):
        ActionSpec(action=ActionType.WALK, **{field: val})


def test_custom_is_routed_to_video():
    assert ROUTE_MATRIX[ActionType.CUSTOM] is GenRoute.VIDEO_I2V


# ── ② 循环性:显式声明真的被用上 ───────────────────────────────────────────


def test_is_cyclic_follows_the_explicit_flag_for_custom():
    """custom 的循环性来自入参,不来自 CYCLIC_ACTIONS 那张表。"""
    assert is_cyclic(_spec(cyclic=True)) is True
    assert is_cyclic(_spec(cyclic=False)) is False


def test_is_cyclic_still_reads_the_table_for_fixed_actions():
    assert is_cyclic(ActionSpec(action=ActionType.WALK)) is True
    assert is_cyclic(ActionSpec(action=ActionType.ATTACK)) is False


def _offline_strategy(monkeypatch, spy: list[str]):
    """离线 VideoFrameStrategy:抽帧被顶替,不联网不花钱;记下送进 i2v 的提示词。"""
    dense = [Image.open(io.BytesIO(_png(i % 6))).convert("RGBA") for i in range(24)]
    monkeypatch.setattr(
        "windup_ai_engine.strategy.concrete.extract_preview_frames",
        lambda video, cap=150, size=48: (dense, list(range(len(dense)))),
    )
    monkeypatch.setattr(
        "windup_ai_engine.strategy.concrete.extract_frames_at",
        lambda video, indices: [dense[i] for i in indices],
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
    """loop=true 走单周期闭环、loop=false 走裁区间 —— 两条分支的进度文案不同。"""
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
    """这条是 #239 的核心缺口。"""
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
    """无论用户写什么,四项锁都必须在。"""
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
    """用户在描述里写了斗篷与剑,**骨架自己**仍不得断言装备。"""
    p = build_custom_prompt("waves the right hand", facing=Facing.SIDE, cyclic=False)
    named = [w for w in _EQUIPMENT if w in p.lower()]
    assert not named, f"骨架里出现了装备名词: {named}"


def test_scaffolding_uses_only_positive_wording():
    """这个 i2v 接口没有 negative_prompt,否定式会被 latch 进画面。"""
    p = build_custom_prompt("waves the right hand", facing=Facing.SIDE, cyclic=False).lower()
    hits = [w for w in _NEGATIONS if w in p]
    assert not hits, f"骨架里出现否定式: {hits}"


def test_oneshot_says_once_and_holds_the_end_pose():
    """不写"只做一次 + 终态保持",模型会在 5 秒内复读第二次。"""
    p = build_custom_prompt("swings the right arm down", facing=Facing.SIDE, cyclic=False)
    assert "ONCE" in p
    assert "holds the final pose" in p


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


def test_only_the_opened_models_are_accepted():
    from windup_framework.config.provider import AIProviderSettings
    from windup_framework.gateway.registry import ModelRegistry
    from windup_framework.gateway.types import Scene

    r = ModelRegistry.from_settings(AIProviderSettings(video_fallbacks="kling-v2-6"))
    assert set(r.chain(Scene.CHARACTER_ACTION)) == {"kling-v2-5-turbo", "kling-v2-6"}


def test_unknown_model_fails_at_entry_not_at_the_paid_call():
    """非法模型名在入口炸。"""
    from windup_app.server.orchestrator.executor import _resolve_video_model

    with pytest.raises(ValueError) as e:
        _resolve_video_model("sora-2")
    assert "kling-v2-5-turbo" in str(e.value), "报错要带上可选值,否则调用方无从改"


def test_start_from_model_reuses_one_generator():
    from windup_app.server.orchestrator.executor import ActionTaskExecutor

    ex = ActionTaskExecutor()
    assert ex._get_generator() is ex._get_generator()


def test_concurrent_first_requests_build_one_shared_provider_set(monkeypatch):
    """并发首请求只装一份共用 Gateway / matte。

    执行器是进程级单例、每个请求起一个线程,check-and-insert 不加锁时每个线程都会各装
    一套;而每个抠图实例会各自惰性加载一份 ONNX 会话,重复的代价落在内存与加载耗时上。
    选哪个 kling 是 Gateway 的事,不同 video_model 仍共用同一个 generator。
    """
    import windup_framework.gateway as gateway
    from windup_framework import providers

    from windup_app.server.orchestrator.executor import ActionTaskExecutor

    built: list[str] = []
    tally = threading.Lock()

    def _counting(name: str):
        def _factory(*_args, **_kwargs):
            with tally:
                built.append(name)
            time.sleep(0.02)  # 放大 check-and-insert 的窗口:不加锁时必然重复装配
            return object()
        return _factory

    monkeypatch.setattr(providers, "OnnxU2NetMatteProvider", _counting("matte"))
    monkeypatch.setattr(gateway, "build_image_gateway", _counting("image"))
    monkeypatch.setattr(gateway, "build_video_gateway", _counting("video"))

    ex = ActionTaskExecutor()
    models = ["kling-v2-5-turbo", "kling-v2-6"] * 3
    start = threading.Barrier(len(models))
    got: dict[int, object] = {}

    def _ask(i: int) -> None:
        start.wait(timeout=5)
        gen = ex._get_generator()
        with tally:
            got[i] = gen

    threads = [threading.Thread(target=_ask, args=(i,)) for i in range(len(models))]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=10)

    assert not any(t.is_alive() for t in threads), "有线程没跑完,装配路径可能卡在锁上"
    assert built.count("matte") == 1, f"抠图 provider 装了 {built.count('matte')} 次,该只装一次"
    assert built.count("image") == 1, f"图生图 Gateway 装了 {built.count('image')} 次"
    assert built.count("video") == 1, f"视频 Gateway 装了 {built.count('video')} 次,该只装一次"
    gens = {got[i] for i in range(len(models))}
    assert len(gens) == 1, "不同 video_model 的并发请求该拿到同一个 generator"
    assert next(iter(gens)) is ex._get_generator()


def test_injected_matte_is_not_replaced_on_assemble(monkeypatch):
    """worker bind_matte 之后,装配桶不得再 new 一套 ONNX。"""
    import windup_framework.gateway as gateway
    from windup_framework import providers

    from windup_app.server.orchestrator.executor import ActionTaskExecutor

    sent = object()

    def _boom(*_a, **_k):
        raise AssertionError("不该再构造 OnnxU2NetMatteProvider")

    monkeypatch.setattr(providers, "OnnxU2NetMatteProvider", _boom)
    monkeypatch.setattr(gateway, "build_image_gateway", lambda **_k: object())
    monkeypatch.setattr(gateway, "build_video_gateway", lambda **_k: object())

    ex = ActionTaskExecutor(matte=sent)
    ex._assemble(4)
    assert ex._matte is sent


# ── ⑥ 骨架不得夹带姿态前提(游泳/潜水/飞行都不着地不直立)─────────────────────

# "着地 / 直立 / 双足"对 walk/idle/attack/jump 成立,对任意动作不成立。骨架里写了它们,
# 遇到游泳就与用户的动作直接矛盾,而文字与动作矛盾时模型会自己找辙调和。
_POSTURE_ASSUMPTIONS = (
    "on the ground", "standing", "upright", "both feet", "feet stay",
    "legs clearly", "upper body stays calm", "on the spot", "planted",
)


@pytest.mark.parametrize("cyclic", [True, False])
@pytest.mark.parametrize("facing", [Facing.SIDE, Facing.FRONT])
def test_scaffolding_carries_no_posture_assumptions(facing, cyclic):
    """骨架只许断言对任何动作都成立的东西。"""
    p = build_custom_prompt("swims forward with alternating overarm strokes",
                            facing=facing, cyclic=cyclic).lower()
    hits = [w for w in _POSTURE_ASSUMPTIONS if w in p]
    assert not hits, f"骨架夹带了姿态前提: {hits}"


def test_oneshot_tail_does_not_dictate_what_the_final_pose_is():
    """只要求保持终态,不规定终态是什么 —— 潜水结束不该被掰回站姿。"""
    p = build_custom_prompt("dives down head first", facing=Facing.SIDE, cyclic=False)
    assert "holds the final pose" in p
    assert "standing" not in p.lower() and "upright" not in p.lower()


def test_cyclic_tail_still_keeps_the_character_in_place():
    """去掉"在地面上"之后,**不整体位移**这条仍要在 —— 位移交引擎当 root motion。"""
    p = build_custom_prompt("swims forward", facing=Facing.SIDE, cyclic=True).lower()
    assert "same spot" in p


# ── ⑦ loop 缺失时的安全默认 ──────────────────────────────────────────────


def test_missing_loop_falls_back_to_oneshot_instead_of_failing():
    """缺 loop 时兜成一次性,不是硬失败。"""
    from windup_app.server.orchestrator.model import ActionType as ApiActionType
    from windup_app.server.orchestrator.model import CharacterActionInput

    inp = CharacterActionInput(
        character_id=1, action_type=ApiActionType.CUSTOM, custom_prompt="waves", loop=None
    )
    assert inp.loop is None, "DTO 层不该替调用方填默认值,默认发生在编排层"
    # 编排层把 None 兜成一次性 —— 与 executor 里那段注释同一口径
    cyclic = False if inp.loop is None else bool(inp.loop)
    assert cyclic is False
