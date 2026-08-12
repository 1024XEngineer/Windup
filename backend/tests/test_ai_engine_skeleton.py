"""ai_engine 串联 smoke —— 验证架构串联成立:路由正确 + generate 端到端跑通。

策略内部(真实 i2v)用 mock / monkeypatch 顶替(真实生成联网、抽帧要解码 mp4);
本测证明"选路线 → derive → 最后一公里(真实对齐)→ GeneratedAction(帧 + 时长)"这条串联为真。
"""
from __future__ import annotations

import io

from PIL import Image

from windup_ai_engine.impl import CharacterGenerator
from windup_ai_engine.impl.character_generator import _DERIVE_FROM, _DERIVE_TO
from windup_ai_engine.ports import GeneratedAction
from windup_ai_engine.postprocess.rootmotion import DEFAULT_FPS_MS
from windup_ai_engine.strategy import (
    ROUTE_MATRIX,
    DerivationStrategy,
    VideoFrameStrategy,
)
from windup_common.models import (
    ActionSpec,
    ActionType,
    CharacterCard,
    Facing,
    GenRoute,
    Stylize,
)


def _tiny_png(color=(200, 60, 60, 255), shift=0) -> bytes:
    """一张带主体的小 RGBA PNG(四周留透明边,供真实对齐 / 抠图链处理)。"""
    img = Image.new("RGBA", (64, 96), (0, 0, 0, 0))
    for y in range(20, 80):
        for x in range(24 + shift, 40 + shift):
            img.putpixel((x, y), color)
    buf = io.BytesIO()
    img.save(buf, "PNG")
    return buf.getvalue()


class _NullProgress:
    def step(self, stage: str, i: int, total: int, note: str = "") -> None:
        pass


class _MockWalkStrategy(DerivationStrategy):
    """顶替真实 VideoFrameStrategy:返回 N 张真 PNG,让对齐真跑。"""

    route = GenRoute.VIDEO_I2V

    def derive(self, card, action, master, progress) -> list[bytes]:
        return [_tiny_png() for _ in range(action.n_frames)]


def _make_generator() -> CharacterGenerator:
    return CharacterGenerator({GenRoute.VIDEO_I2V: _MockWalkStrategy()})


def test_route_matrix_is_the_measured_contract():
    # 实测挣得的架构决策:走路/跑/攻击走视频,受击逐帧,待机程序化
    assert ROUTE_MATRIX[ActionType.WALK] is GenRoute.VIDEO_I2V
    assert ROUTE_MATRIX[ActionType.RUN] is GenRoute.VIDEO_I2V
    assert ROUTE_MATRIX[ActionType.ATTACK] is GenRoute.VIDEO_I2V
    assert ROUTE_MATRIX[ActionType.JUMP] is GenRoute.VIDEO_I2V
    assert ROUTE_MATRIX[ActionType.HIT] is GenRoute.PER_FRAME
    assert ROUTE_MATRIX[ActionType.IDLE] is GenRoute.VIDEO_I2V


def test_generate_walk_is_wired_end_to_end():
    card = CharacterCard(name="rogue", desc="hooded ranger, dual daggers")
    # 视频路线只需声明帧数;poses 是逐帧路线的入参,这里不传(以前必须编 8 条假描述)。
    action = ActionSpec(action=ActionType.WALK, n_frames=8)
    out = _make_generator().generate(card, action, master=_tiny_png(), progress=_NullProgress())
    assert isinstance(out, GeneratedAction)
    assert len(out.frames) == 8                       # 选路线→derive→对齐 全串通
    assert len(out.durations) == 8                    # 逐帧时长与帧等长
    # 时长是按动作查表来的,不是从入参帧率算的 —— walk 的基准是 125ms/帧。
    # 原先这里断言的是 `out.fps == action.fps`,把"照抄一个不生效的入参"锁成了契约。
    assert all(d > 0 for d in out.durations)
    assert set(out.durations) == {DEFAULT_FPS_MS["walk"]}
    assert all(f and f[:8] == b"\x89PNG\r\n\x1a\n" for f in out.frames)  # 真 PNG


def test_action_spec_stylize_defaults_and_toggle():
    # 像素化是开关(默认 pixel),可关成 none 保留 i2v 画风
    assert ActionSpec(action=ActionType.WALK).stylize is Stylize.PIXEL
    a = ActionSpec(action=ActionType.WALK, stylize="none")
    assert a.stylize is Stylize.NONE


def _offline_video_strategy(monkeypatch, video=None) -> VideoFrameStrategy:
    """离线版 VideoFrameStrategy:抽帧被顶替,不解码 mp4 / 不联网 / 不花钱。"""
    dense = [Image.open(io.BytesIO(_tiny_png(shift=i % 6))).convert("RGBA") for i in range(24)]
    monkeypatch.setattr(
        "windup_ai_engine.strategy.concrete.extract_all_frames_bytes",
        lambda video, cap=150: dense,
    )

    class _StubVideo:
        def i2v(self, first_frame, prompt, seconds=5, size="1280x720"):
            return b"fake-mp4"

    class _StubMatte:
        def cutout(self, frame):   # 透传:合成帧已带 alpha
            return frame

    return VideoFrameStrategy(video or _StubVideo(), _StubMatte())


def test_video_strategy_derive_runs_offline(monkeypatch):
    """真实 VideoFrameStrategy.derive 离线跑通。

    证明 derive 的真实链路:i2v → 抽帧 → 抠图 → 选帧 → 出帧,产物是合法 RGBA PNG。
    """
    strat = _offline_video_strategy(monkeypatch)
    card = CharacterCard(name="knight", desc="plate armor, sword")
    action = ActionSpec(action=ActionType.WALK, stylize="none", n_frames=8)
    out = strat.derive(card, action, master=_tiny_png(), progress=_NullProgress())
    assert out and all(f[:8] == b"\x89PNG\r\n\x1a\n" for f in out)


def test_video_strategy_honours_n_frames_without_any_poses(monkeypatch):
    """帧数由 ActionSpec.n_frames 决定,**不必传 poses** —— A2 的落地验证。

    以前只能靠 len(poses) 表达帧数,于是"要 6 帧"得先编 6 条视频路线根本不读的姿势描述;
    读代码的人会以为那 6 条描述真的进了提示词。
    """
    strat = _offline_video_strategy(monkeypatch)
    card = CharacterCard(name="knight", desc="plate armor, sword")
    for n in (4, 6, 11):
        action = ActionSpec(action=ActionType.WALK, stylize="none", n_frames=n)
        out = strat.derive(card, action, master=_tiny_png(), progress=_NullProgress())
        assert len(out) == n, f"要 {n} 帧,实得 {len(out)} 帧"


def test_video_strategy_stylize_switch_actually_changes_the_pixels(monkeypatch):
    """stylize 分支不能接反 —— 只验"两条分支都不抛错"验不出接反。

    none=原样出帧(与输入同尺寸);pixel=裁包围盒 + 重采样到目标像素高,尺寸必然不同。
    """
    strat = _offline_video_strategy(monkeypatch)
    card = CharacterCard(name="knight", desc="plate armor, sword")
    plain = strat.derive(
        card, ActionSpec(action=ActionType.WALK, stylize=Stylize.NONE, n_frames=4),
        master=_tiny_png(), progress=_NullProgress(),
    )
    pixel = strat.derive(
        card, ActionSpec(action=ActionType.WALK, stylize=Stylize.PIXEL, n_frames=4),
        master=_tiny_png(), progress=_NullProgress(),
    )
    assert Image.open(io.BytesIO(plain[0])).size == (64, 96)      # 未像素化:原尺寸
    assert Image.open(io.BytesIO(pixel[0])).size != (64, 96)      # 像素化:重采样过


def test_video_strategy_prompt_follows_facing(monkeypatch):
    """喂给 i2v 的提示词随 ActionSpec.facing 走 —— 朝向约束真的传到了付费调用那一层。

    这是 facing 枚举化要保护的东西:枚举保证值合法,本测保证合法值被用对。
    """
    seen: list[str] = []

    class _SpyVideo:
        def i2v(self, first_frame, prompt, seconds=5, size="1280x720"):
            seen.append(prompt)
            return b"fake-mp4"

    strat = _offline_video_strategy(monkeypatch, video=_SpyVideo())
    card = CharacterCard(name="knight", desc="plate armor, sword")
    for facing in (Facing.SIDE, Facing.FRONT):
        strat.derive(
            card,
            ActionSpec(action=ActionType.WALK, stylize=Stylize.NONE, n_frames=4, facing=facing),
            master=_tiny_png(), progress=_NullProgress(),
        )
    assert "SIDE VIEW facing right" in seen[0]
    assert "FACING THE VIEWER" in seen[1]


def test_real_video_strategy_is_registered_for_video_route():
    # 真实 VideoFrameStrategy 可构造且声明视频路线(derive 联网,不在此跑)
    class _V:
        def i2v(self, first_frame, prompt, seconds=5, size="1280x720"):
            return b""

    class _M:
        def cutout(self, frame):
            return frame

    strat = VideoFrameStrategy(_V(), _M())
    assert strat.route is GenRoute.VIDEO_I2V


# ── 未实现的路线必须炸,不能吐空帧(2026-08-07)─────────────────────────────
#
# 旧行为:PerFrameStrategy.derive 返回 [b""] * n_frames,CharacterGenerator._lastmile
# 见到空帧就静默跳过对齐、原样返回。调用方拿到的 GeneratedAction 帧数对、时长对、
# 无异常 —— 完全像一次成功的生成。server 会把 N 个 0 字节文件传上对象存储、写进
# character_data,用户看到 N 张裂图,且排查时不会想到是"路线没实现"。
#
# 新行为:在最早能判定的边界上抛错。下面三条分别覆盖三个入口。


def test_unimplemented_route_raises_instead_of_returning_empty_frames():
    """PerFrameStrategy 调用即抛,不返回空帧。"""
    import pytest

    from windup_ai_engine.strategy import PerFrameStrategy

    s = PerFrameStrategy(image=None, matte=None)
    card = CharacterCard(name="t", desc="t")
    action = ActionSpec(action=ActionType.HIT, poses=["a", "b", "c"])
    with pytest.raises(NotImplementedError, match="per_frame"):
        s.derive(card, action, _tiny_png(), _NullProgress())


def test_missing_strategy_for_route_raises_with_what_is_wired():
    """装配表里没有该路线时抛错,并报出已装配了哪些 —— 便于定位是漏注入还是没实现。"""
    import pytest

    # 只装 VIDEO_I2V,请求 hit(分流到 PER_FRAME)
    gen = CharacterGenerator({GenRoute.VIDEO_I2V: _MockWalkStrategy()})
    card = CharacterCard(name="t", desc="t")
    action = ActionSpec(action=ActionType.HIT, poses=["a", "b"])
    with pytest.raises(NotImplementedError, match="video_i2v"):
        gen.generate(card, action, _tiny_png(), _NullProgress())


def test_empty_frames_from_strategy_are_rejected():
    """strategy 吐出空帧(provider / 抠图坏了)时同样要炸,不原样放行。"""
    import pytest

    class _EmptyStrategy(DerivationStrategy):
        route = GenRoute.VIDEO_I2V

        def derive(self, card, action, master, progress) -> list[bytes]:
            return [b"", b"", b""]

    gen = CharacterGenerator({GenRoute.VIDEO_I2V: _EmptyStrategy()})
    card = CharacterCard(name="t", desc="t")
    action = ActionSpec(action=ActionType.WALK, poses=["a", "b", "c"])
    with pytest.raises(ValueError, match="空帧"):
        gen.generate(card, action, _tiny_png(), _NullProgress())


def test_short_frame_count_from_strategy_is_rejected():
    """产出帧数少于 ``n_frames`` 时要炸 —— 少给不会崩,只会"短一截"。

    这不是假想:slicing.pick_cycle / pick_oneshot 在源帧不足(i2v 视频太短 / 动作区间
    过窄)时 ``return frames`` / ``return span``,长度不足且不报错。时长表由
    frame_durations(…, len(frames)) 现算,所以产物内部自洽 —— server 看不出异常,
    用户拿到一段步子没走完的循环。A2 之后 n_frames 是调用方的明确承诺,必须对账。
    """
    import pytest

    class _ShortStrategy(DerivationStrategy):
        route = GenRoute.VIDEO_I2V

        def derive(self, card, action, master, progress) -> list[bytes]:
            return [_tiny_png() for _ in range(action.n_frames - 1)]   # 少给一帧

    gen = CharacterGenerator({GenRoute.VIDEO_I2V: _ShortStrategy()})
    card = CharacterCard(name="t", desc="t")
    with pytest.raises(ValueError, match="要 8 帧,实际产出 7 帧"):
        gen.generate(
            card, ActionSpec(action=ActionType.WALK, n_frames=8),
            _tiny_png(), _NullProgress(),
        )


def test_progress_notes_carry_enum_values_not_python_reprs():
    """进度文案里不能出现 "ActionType.WALK"。

    Python 3.11 改了 str-mixin 枚举的 __format__:f"{ActionType.WALK}" 从 "walk" 变成
    "ActionType.WALK"(3.12.13 实测)。这串字经 server 变成用户看到的 SSE 进度文案,
    没有任何测试会因此变红 —— 属于"跑得通但对外是错的"那一类。
    """
    notes: list[str] = []

    class _SpyProgress:
        def step(self, stage: str, i: int, total: int, note: str = "") -> None:
            notes.append(note)

    _make_generator().generate(
        CharacterCard(name="t", desc="t"),
        ActionSpec(action=ActionType.WALK, n_frames=4),
        _tiny_png(), _SpyProgress(),
    )
    assert notes, "没收到任何进度上报"
    assert not any("ActionType." in n for n in notes), notes
    assert any("walk" in n for n in notes), notes


class _SubSteppingStrategy(DerivationStrategy):
    """按自己的刻度报 3 步 —— 与真实 VideoFrameStrategy 的上报形状一致。

    ``_MockWalkStrategy`` 一步都不报,用它测不出跨层刻度问题:必须有个子组件真的
    往同一个 ProgressPort 上报自己的 (i, total)。
    """

    route = GenRoute.VIDEO_I2V

    def derive(self, card, action, master, progress) -> list[bytes]:
        progress.step("derive", 0, 3, "i2v 生成视频")
        progress.step("derive", 1, 3, "抽帧 + 抠图")
        progress.step("derive", 2, 3, "风格化")
        return [_tiny_png() for _ in range(action.n_frames)]


def _run_and_collect_progress() -> list[tuple[str, int, int]]:
    seen: list[tuple[str, int, int]] = []

    class _SpyProgress:
        def step(self, stage: str, i: int, total: int, note: str = "") -> None:
            seen.append((stage, i, total))

    CharacterGenerator({GenRoute.VIDEO_I2V: _SubSteppingStrategy()}).generate(
        CharacterCard(name="t", desc="t"),
        ActionSpec(action=ActionType.WALK, n_frames=4),
        _tiny_png(), _SpyProgress(),
    )
    return seen


def test_progress_reports_one_scale_end_to_end():
    """整条生产线只能有一个 total。

    修之前 generator 报 i/4、中间夹着的 strategy 报 i/3,两套刻度混在同一个
    ProgressPort 上,消费方按 i/total 画条会看到 totals={3,4}。
    """
    totals = {t for _, _, t in _run_and_collect_progress()}
    assert len(totals) == 1, f"同一次生成里出现了多个 total: {sorted(totals)}"


def test_progress_never_goes_backwards():
    """进度不许倒退 —— 这是 #181 评审实跑逮到的那个症状。

    修之前实测倒退两次:route 25.0% → derive 0.0%、derive 66.7% → lastmile 50.0%。
    """
    seen = _run_and_collect_progress()
    pcts = [i / t for _, i, t in seen]
    back = [
        (seen[k - 1], seen[k]) for k in range(1, len(pcts)) if pcts[k] < pcts[k - 1]
    ]
    assert not back, f"进度倒退 {len(back)} 次: {back}"


def test_strategy_sub_progress_lands_inside_the_derive_band():
    """子进度必须落在 derive 区间内,且区间内确实动了。

    只断言"不倒退"是不够的:把 _BandProgress 换成"永远报区间起点"也能通过那一条,
    进度条会在 derive 段整段卡住不动 —— 而 derive 是最慢的一段。
    """
    seen = _run_and_collect_progress()
    derive = [i for stage, i, _ in seen if stage == "derive"]
    assert derive, "没收到 derive 段的进度"
    assert min(derive) >= _DERIVE_FROM and max(derive) <= _DERIVE_TO, derive
    assert len(set(derive)) > 1, f"derive 段整段没动: {derive}"


def test_generated_action_has_a_single_timing_source():
    """出参不许有第二个描述播放速度的字段。

    此处曾有一条 ``test_loop_mode_currently_changes_nothing``,把"传 pingpong / none
    不改变任何一帧"钉成可执行事实,理由是"将来真接线时它会变红提醒删注释"。
    那是把缺陷固化:调用方能为一段往返动画付费、拿到一段线性循环,而测试为这个行为背书。
    2026-08-10 按机器审意见改成删字段 —— ``ActionSpec.loop`` 与 ``LoopMode`` 都已移除,
    真要支持 pingpong,连同 pick_cycle 的分支与出参时序契约一起加回。

    同批删掉的 ``GeneratedAction.fps`` 同理:它抄自入参、与 durations 互相矛盾。
    """
    from dataclasses import fields

    names = {f.name for f in fields(GeneratedAction)}
    assert "fps" not in names, "fps 与 durations 会给出两个不同的播放速度"
    assert "durations" in names


def test_genroute_only_lists_implemented_routes():
    """GenRoute 只列有实现的路线 —— 没有实现的枚举值等于死代码。

    这条同时管住两个方向：
      - PROC_IDLE（程序化待机，#53 原设计）已证否，连同 ProcIdleStrategy 一并移除；
      - 未来路线（三渲二渲染出帧）**不提前留位**，契约需求记在 Issue，随实现一起加成员。
    枚举加成员是纯加法，不构成破坏性变更，所以"提前留位免得二次改形"不成立。
    """
    assert {r.value for r in GenRoute} == {"video_i2v", "per_frame"}
    import windup_ai_engine.strategy as strat
    assert not hasattr(strat, "ProcIdleStrategy")
