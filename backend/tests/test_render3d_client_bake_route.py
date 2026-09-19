"""默认路径:三渲二的出帧挂给浏览器,worker 不下模型也不起出帧台(#714)。

与 ``test_render3d_client_bake`` 分工:那份验 Redis 登记与收帧的形状,这份验**编排层
真的走到了那一支**,以及交回的帧仍要过服务端的每一道闸。

最容易漏的两条,都在这里钉住:

  ① **模型仍被下到应用机。** 出帧在浏览器里跑,而 worker 照旧 fetch 一遍 60MB GLB ——
     省下的只有 Chromium,上行和内存一分没省,而且没有任何一处会报错。
  ② **闸口跟着搬走。** 帧来自客户端就不再验空帧 / 不再对账帧数,于是全透明帧和少一张
     的序列直接进交付,下游帧数、时长、成色全部自洽。
"""

from __future__ import annotations

import io

import pytest
from PIL import Image

from windup_ai_engine.impl import CharacterGenerator
from windup_ai_engine.strategy.concrete import RenderFrameStrategy
from windup_app.server.orchestrator import client_bake
from windup_app.server.orchestrator.client_bake import ActionAwaitingClientBake
from windup_app.server.orchestrator.executor import ActionTaskExecutor, ProjectConstraints
from windup_app.server.orchestrator.model import ActionType as InputActionType
from windup_app.server.orchestrator.model import CharacterActionInput
from windup_common.models import ActionSpec, ActionType, CharacterCard, Facing, GenRoute

OUTFIT = "outfit-default"
MODEL_URL = "https://cdn.test/media/model-3d/rigged.glb"


def _png(w: int = 64, h: int = 96, *, blank: bool = False) -> bytes:
    """真 RGBA PNG。``blank`` 造全透明帧 —— 那正是出帧台在角色出画时会安静产出的东西。"""
    image = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    if not blank:
        for y in range(20, 80):
            for x in range(24, 40):
                image.putpixel((x, y), (200, 60, 60, 255))
    buffer = io.BytesIO()
    image.save(buffer, "PNG")
    return buffer.getvalue()


class _NullProgress:
    def step(self, stage: str, i: int, total: int, note: str = "") -> None:
        pass


def _generator() -> CharacterGenerator:
    """真 generator + 真 strategy,**出帧台传 None** —— 这条路上本就不该有它。"""
    return CharacterGenerator({GenRoute.RENDER_3D: RenderFrameStrategy(None, directions=4)})


def _spec(n_frames: int = 4) -> ActionSpec:
    return ActionSpec(
        action=ActionType.WALK, poses=[""] * n_frames, facing=Facing.SIDE
    )


@pytest.fixture
def opened(monkeypatch):
    """把 Redis 与延迟队列换成内存桩,返回记录下来的登记。"""
    jobs: dict[int, client_bake.ClientBakeSpec] = {}
    monkeypatch.setattr(
        client_bake, "open_job", lambda task_id, spec: jobs.setdefault(task_id, spec) and 0.0
    )
    monkeypatch.setattr("windup_app.server.orchestrator.executor.is_own_media", lambda url: True)
    return jobs


def test_default_path_hands_baking_to_the_browser_and_never_fetches_the_model(opened):
    """默认路径:登记出帧任务、抛等待态,且**一次模型下载都不发生**。"""
    executor = ActionTaskExecutor(
        generator=_generator(),
        upload=lambda _png: pytest.fail("还没出帧就上传了"),
        fetch_master=lambda _input: pytest.fail("走三渲二不该去下载母版"),
        fetch_model3d=lambda url: pytest.fail(
            "出帧交给浏览器了,应用机不该再下这份 GLB —— 省下 Chromium 但没省上行"
        ),
        fetch_constraints=lambda *_: ProjectConstraints(sprite_w=64, sprite_h=64),
    )
    with pytest.raises(ActionAwaitingClientBake):
        executor._produce_action(
            CharacterActionInput(
                character_id=1,
                action_type=InputActionType.WALK,
                num_frames=4,
                outfit_id=OUTFIT,
                model_3d_url=MODEL_URL,
            ),
            ProjectConstraints(sprite_w=64, sprite_h=64),
            task_id=11,
        )
    spec = opened[11]
    assert spec.model_url == MODEL_URL
    assert (spec.clip, spec.direction, spec.frames) == ("walk", "e", 4)
    assert spec.material in ("cel", "lit", "clay", "toon", "orig")


def test_model_url_outside_own_storage_is_refused(monkeypatch):
    """地址不是自家对象存储就不能发给浏览器 —— 那等于借用户的浏览器和登录态发请求。"""
    monkeypatch.setattr("windup_app.server.orchestrator.executor.is_own_media", lambda url: False)
    executor = ActionTaskExecutor(
        generator=_generator(),
        upload=lambda _png: "https://cdn.test/f.png",
        fetch_constraints=lambda *_: ProjectConstraints(sprite_w=64, sprite_h=64),
    )
    with pytest.raises(Exception, match="不在自家对象存储"):
        executor._produce_action(
            CharacterActionInput(
                character_id=1,
                action_type=InputActionType.WALK,
                num_frames=4,
                outfit_id=OUTFIT,
                model_3d_url="https://evil.test/x.glb",
            ),
            ProjectConstraints(sprite_w=64, sprite_h=64),
            task_id=12,
        )


def test_plan_is_the_only_source_of_render_parameters():
    """出帧参数只有一份真相源。朝向表分叉不会报错,只会让角色朝反方向走。"""
    from windup_framework.providers.render3d import DIRECTIONS_4, DIRECTIONS_8

    for directions, table in ((4, DIRECTIONS_4), (8, DIRECTIONS_8)):
        plan = RenderFrameStrategy(None, directions=directions).plan(_spec())
        assert plan.camera_yaw == float(table[plan.direction])
        assert (plan.width, plan.height) == (1536, 2560)


def test_finish_rendered_runs_the_same_gates_as_server_side_baking():
    """浏览器交回的帧走完 _finish:帧数对账、脚线对齐、成色测量一道不少。"""
    generated = _generator().finish_rendered(
        [_png()] * 4, CharacterCard(name="c", desc=""), _spec(4), _NullProgress(), canvas=(64, 64)
    )
    assert len(generated.frames) == 4
    assert len(generated.durations) == 4
    assert generated.quality is not None


def test_finish_rendered_rejects_wrong_frame_count():
    """少一帧的后果是"步子没走完的动作",下游全部自洽 —— 只能在这里拦。"""
    with pytest.raises(ValueError, match="契约要 4 帧"):
        _generator().finish_rendered(
            [_png()] * 3, CharacterCard(name="c", desc=""), _spec(4), _NullProgress(),
            canvas=(64, 64),
        )


def test_finish_rendered_rejects_all_transparent_frames():
    """客户端自报的覆盖率只是它的说法;服务端必须自己再数一遍。"""
    with pytest.raises(ValueError, match="几乎全透明"):
        _generator().finish_rendered(
            [_png(), _png(blank=True), _png(), _png()],
            CharacterCard(name="c", desc=""), _spec(4), _NullProgress(), canvas=(64, 64),
        )


def test_derive_without_a_stage_says_so_instead_of_crashing_obscurely():
    """出帧台缺席时报错要指得准 —— 不然只会看到一句 AttributeError。"""
    with pytest.raises(RuntimeError, match="没有注入出帧台"):
        RenderFrameStrategy(None, directions=4).derive(
            CharacterCard(name="c", desc=""), _spec(4), b"GLB", _NullProgress()
        )


# ── 骨架事实与位移轨的落点（#774）────────────────────────────────────────


def test_server_render_carries_rig_facts_and_root_motion():
    """服务端渲那条要把出帧台读到的两样带进出参 —— 此前算完即丢。"""
    from windup_framework.providers.render3d import RigInfo, SpriteSequence, SpriteSheet

    class _Renderer:
        def render(self, model, **kwargs):
            return SpriteSheet(
                clip="walk",
                duration_s=1.0,
                sample_times=[0.0, 0.5],
                sequences=[SpriteSequence(direction="e", camera_yaw=0.0, frames=[_png()] * 4)],
                rig=RigInfo(bones=28, skinned_meshes=1, vertices=51388,
                            root_bone="Hips", loader="gltf"),
                available_clips={"walk": 1.07, "idle": 10.03},
                # **不要按片段名再包一层。** ``bake_driver.mjs`` 交回 meta 时已经拆过
                # (``root_motion: rootMotion[clip] ?? null``),``sprite.py`` 原样透传 ——
                # 所以 ``SpriteSheet.root_motion`` 就是这一段本身。桩多包一层的话,
                # 生产里"多取一层导致恒为 None"这个真 bug 在测试里永远看不见(它就是这么合进来的)。
                root_motion={"unit": "1.0 = 角色总高",
                             "disp": [[0.0, 0.0], [0.05, 0.0], [0.1, 0.0], [0.15, 0.0]],
                             "total_span": 0.15},
            )

    from windup_ai_engine.impl import CharacterGenerator
    generator = CharacterGenerator(
        {GenRoute.RENDER_3D: RenderFrameStrategy(_Renderer(), directions=4)}
    )
    out = generator.generate_rendered(
        CharacterCard(name="c", desc=""), _spec(4), b"GLB", _NullProgress(), canvas=(64, 64)
    )
    assert out.rig is not None, "骨架事实又被丢掉了"
    assert out.rig.bones == 28
    assert out.rig.available_clips == {"walk": 1.07, "idle": 10.03}
    assert out.root_motion == [(0.0, 0.0), (0.05, 0.0), (0.1, 0.0), (0.15, 0.0)]


def test_i2v_route_has_no_rig_facts():
    """i2v 没有骨架，这两样必须是 None —— 不能拿上一次三渲二的残留冒充。"""
    generated = _generator().finish_rendered(
        [_png()] * 4, CharacterCard(name="c", desc=""), _spec(4), _NullProgress(), canvas=(64, 64)
    )
    assert generated.rig is None
    assert generated.root_motion is None


def test_delivered_payload_carries_both(monkeypatch, opened):
    """落库出参里要有 rig_facts 与 root_motion 两个键。"""
    from windup_ai_engine.ports import RigFacts

    executor = ActionTaskExecutor(
        generator=_generator(),
        upload=lambda _png: "https://cdn.test/f.png",
        fetch_constraints=lambda *_: ProjectConstraints(sprite_w=64, sprite_h=64),
    )
    generated = _generator().finish_rendered(
        [_png()] * 4, CharacterCard(name="c", desc=""), _spec(4), _NullProgress(), canvas=(64, 64)
    )
    import dataclasses as _dc
    generated = _dc.replace(
        generated,
        rig=RigFacts(bones=27, root_bone=None, bone_names=("a", "b"),
                     skinned_meshes=1, vertices=10, available_clips={}),
        root_motion=[(0.0, 0.0), (0.2, 0.0)],
    )
    result = executor._deliver_generated(
        generated,
        CharacterActionInput(character_id=1, action_type=InputActionType.WALK,
                             num_frames=4, outfit_id=OUTFIT, model_3d_url=MODEL_URL),
        ProjectConstraints(sprite_w=64, sprite_h=64),
        None,
    )
    assert result["rig_facts"]["bones"] == 27
    assert result["rig_facts"]["bone_names"] == ["a", "b"]
    assert result["root_motion"] == [[0.0, 0.0], [0.2, 0.0]]
