"""三渲二接进编排:谁选路线 + 造型级资产的成本性质。

这一片锁的核心不是"能跑通",而是**三类静默错误**:

  ① **路线永不可达。** 只要资产定位依赖一个 ``executor`` 从没赋过值的 card 字段,
     键就恒为 None、路线永远选不中,**而直接构造 card 的单元测试全绿**。所以本文件里
     最重要的是端到端那条(``test_real_server_path_reaches_render3d_*``):
     从"造型上有 model_3d_url"一路走到"渲帧策略真的被调用",中间不许有测试替身
     替代路线选择本身。

  ② **静默回退。** 该走三渲二却悄悄出了一段 i2v,用户拿到画风 / 成本 / 多朝向能力
     完全不同的产物,而帧数、时长、成色全部正常,没有任何一道会红。

  ③ **资产没被复用。** 图生 3D + 绑骨按动作重付,一个造型 10 个动作贵 10 倍。
     这条只会表现为"有点慢 + 账单变多",不会有任何报错(Refs #121)。
"""
from __future__ import annotations

import io
import pathlib

import pytest
from PIL import Image

from windup_ai_engine.impl import CharacterGenerator
from windup_ai_engine.strategy.concrete import RenderFrameStrategy, VideoFrameStrategy
from windup_app.server.orchestrator.executor import ActionTaskExecutor, ProjectConstraints
from windup_app.server.orchestrator.model import ActionType as InputActionType
from windup_app.server.orchestrator.model import CharacterActionInput
from windup_app.server.orchestrator.render3d_assets import (
    LocalDirAssetStore,
    LocalDirModelReview,
    ModelAwaitingReview,
    Render3DAssetBuilder,
)
from windup_common.models import (
    ActionSpec,
    ActionType,
    CharacterCard,
    Facing,
    GenRoute,
    Stylize,
)
try:
    from windup_framework.providers.render3d import (
        PresetMotion,
        RiggedModel,
        RigInfo,
        SpriteSequence,
        SpriteSheet,
    )
except ModuleNotFoundError as exc:
    # 不静默通过:本文件的替身要**真** provider 的数据类型,自己糊一份等于测"我的假数据
    # 长得像帧"。缺件时整体跳过并把缺的模块名报出来。
    pytest.skip(
        f"缺 {exc.name}(三渲二 provider 层,见 1024XEngineer/Windup#270);"
        "该 PR 合入前本文件整体跳过。",
        allow_module_level=True,
    )


def _png(w: int = 64, h: int = 96) -> bytes:
    """一张带主体的真 RGBA PNG —— 假帧必须能被 _lastmile 真的解码/对齐,
    否则测的是"我的假数据长得像帧"而不是管线。"""
    im = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    for y in range(20, 80):
        for x in range(24, 40):
            im.putpixel((x, y), (200, 60, 60, 255))
    buf = io.BytesIO()
    im.save(buf, "PNG")
    return buf.getvalue()


class _NullProgress:
    def step(self, stage: str, i: int, total: int, note: str = "") -> None:
        pass


class _SpyProgress:
    def __init__(self) -> None:
        self.notes: list[str] = []

    def step(self, stage: str, i: int, total: int, note: str = "") -> None:
        self.notes.append(note)


# ── 假三段(记调用次数,用来证明"每造型一次性")──────────────────────────────


class _FakeModel3D:
    def __init__(self) -> None:
        self.calls = 0

    def image_to_3d(self, master, *, want="GLB", extra_views=None) -> bytes:
        self.calls += 1
        return b"GLB-model-bytes"


class _FakeAutoRig:
    def __init__(self) -> None:
        self.calls = 0

    @property
    def preset_motions(self):
        return {"walk": PresetMotion(name="walk", motion_type=1)}

    def rig(self, model, *, want="GLB", motion=None) -> RiggedModel:
        self.calls += 1
        return RiggedModel(data=b"RIGGED-bytes", fmt="GLB")


def _sheet(directions: tuple[str, ...], n_frames: int) -> SpriteSheet:
    return SpriteSheet(
        clip="walk",
        duration_s=1.0,
        sample_times=[i / n_frames for i in range(n_frames)],
        sequences=[
            SpriteSequence(direction=d, camera_yaw=0.0, frames=[_png()] * n_frames)
            for d in directions
        ],
        rig=RigInfo(bones=28, skinned_meshes=1, vertices=100, root_bone="Hips", loader="glb"),
        available_clips={"walk": 1.0},
    )


class _FakeRenderer:
    """出帧台替身。**只有它是假的** —— 真出帧台要 node + playwright + three.js,
    CI 里跑不了;而路线选择、策略装配、编排接线全部走真代码。"""

    def __init__(self, directions=("e", "n", "w", "s")) -> None:
        self.calls = 0
        self.last_model: bytes | None = None
        self._directions = directions
        self.last_size: tuple[int, int] | None = None

    def render(self, rigged_model, *, clip=None, directions=4, frames=12,
               size=(1536, 2560), material="cel") -> SpriteSheet:
        self.calls += 1
        self.last_model = rigged_model
        self.last_size = size
        return _sheet(self._directions, frames)


class _AutoApproveReview:
    """测试替身:直接放行。**只用于不测这道闸的用例** —— 闸本身另有专门用例。"""

    def __init__(self) -> None:
        self.submitted: list[str] = []

    def submit(self, key: str, model: bytes, fmt: str) -> str:
        self.submitted.append(key)
        return f"<fake>/{key}.{fmt.lower()}"

    def is_approved(self, key: str) -> bool:
        return True


def _builder(tmp_path: pathlib.Path, may_build=True, review=None):
    """``may_build`` 缺省 True:多数用例要验建资产那一支的行为,而这里的三段都是假的、
    不花真钱。**默认档(False)的行为另有专门用例**,见"花钱要有人点头"那一节。

    ``review`` 缺省自动放行,同理 —— 人工确认停点的行为另有专门用例。"""
    m, r = _FakeModel3D(), _FakeAutoRig()
    return Render3DAssetBuilder(
        model3d=m, autorig=r, store=LocalDirAssetStore(tmp_path),
        review=review or _AutoApproveReview(),
        may_build_assets=may_build,
    ), m, r


def _card() -> CharacterCard:
    return CharacterCard(name="仙月", desc="美少女")


def _spec(**kw) -> ActionSpec:
    kw.setdefault("action", ActionType.WALK)
    kw.setdefault("n_frames", 4)
    kw.setdefault("stylize", Stylize.NONE)
    return ActionSpec(**kw)


OUTFIT = "outfit-hanfu-01"


# ══ ① 端到端:走真实 server 路径能选到三渲二 ═══════════════════════════════
#
# 这一节是本文件存在的首要理由,别把它替身化。


def _real_generator(renderer) -> CharacterGenerator:
    """真的 CharacterGenerator + 真的 RenderFrameStrategy,只有出帧台是假的。"""
    return CharacterGenerator({
        GenRoute.VIDEO_I2V: VideoFrameStrategy(video=None, matte=None),
        GenRoute.RENDER_3D: RenderFrameStrategy(renderer),
    })


def test_real_server_path_reaches_render3d_when_the_outfit_has_a_model():
    """造型带 model_3d_url → 编排层真的走到渲帧策略,而不是 i2v。

    这条钉的正是"路线永不可达"那个缺陷:它只断言**编排层自己**选对了路线,
    没有任何替身代替这一步。
    """
    renderer = _FakeRenderer()
    executor = ActionTaskExecutor(
        generator=_real_generator(renderer),
        upload=lambda _png: "https://cdn.example.com/f.png",
        fetch_master=lambda _input: pytest.fail("走三渲二不该去下载母版"),
        fetch_model3d=lambda url: b"RIGGED-bytes",
        fetch_constraints=lambda *_: ProjectConstraints(sprite_w=64, sprite_h=64),
    )
    out = executor._produce_action(
        CharacterActionInput(
            character_id=1,
            action_type=InputActionType.WALK,
            num_frames=4,
            outfit_id=OUTFIT,
            model_3d_url="https://cdn.example.com/outfits/hanfu.glb",
        ),
        ProjectConstraints(sprite_w=64, sprite_h=64),
    )

    assert renderer.calls == 1, "三渲二没被走到 —— 路线选择又断了"
    assert renderer.last_model == b"RIGGED-bytes", "喂给出帧台的不是取回来的那个模型"
    assert len(out["frames"]) == 4


def test_real_server_path_stays_on_i2v_when_the_outfit_has_no_model():
    """没有 model_3d_url 就照旧走 i2v —— 三渲二不是默认路线,也不该抢别人的活。"""
    renderer = _FakeRenderer()
    executor = ActionTaskExecutor(
        generator=_real_generator(renderer),
        upload=lambda _png: "https://cdn.example.com/f.png",
        fetch_master=lambda _input: _png(),
        fetch_model3d=lambda url: pytest.fail("没有 3D 资产却去取模型了"),
        fetch_constraints=lambda *_: ProjectConstraints(sprite_w=64, sprite_h=64),
    )
    with pytest.raises(Exception):
        # VideoFrameStrategy 的 provider 是 None,走到它必然炸 —— 这正是本用例要的:
        # 证明它走的是 i2v 那一支。真正的 i2v 行为在别处有用例。
        executor._produce_action(
            CharacterActionInput(
                character_id=1, action_type=InputActionType.WALK, num_frames=4,
                outfit_id=OUTFIT, model_3d_url=None,
            ),
            ProjectConstraints(sprite_w=64, sprite_h=64),
        )
    assert renderer.calls == 0


def test_web_layer_reads_the_outfit_model_url_into_the_task_input(auth_client, db_session):
    """Web 层要把造型上的 model_3d_url **真的填进任务入参**。

    这一步是上次那个缺陷的落点:字段从没被赋过值,而下游全部正常运行、只是永远
    走不到三渲二。所以要断言的是"值到底进没进入参",不是"端点返回 200"。
    """
    from conftest import seed_credit_account

    seed_credit_account(db_session, 1)
    db_session.commit()

    project = auth_client.post("/projects", json={
        "project_name": "三渲二", "character_perspective": 1, "directional_movement": 2,
        "sprite_width": 64, "sprite_height": 64,
    }).json()["data"]
    character = auth_client.post("/characters", json={
        "project_id": project["id"], "workflow_run_id": 1, "name": "勇者",
        "character_data": {
            "version": 1,
            "outfits": [{
                "id": OUTFIT, "name": "汉服",
                "model_3d_url": "https://cdn.example.com/outfits/hanfu.glb",
                "actions": [],
            }],
        },
    }).json()["data"]

    resp = auth_client.post("/generation/action", json={
        "project_id": project["id"], "character_id": character["id"],
        "action_type": "walk", "num_frames": 4, "outfit_id": OUTFIT,
    })

    assert resp.json()["data"] is not None, resp.json()
    task_id = resp.json()["data"]["id"]
    task = auth_client.get(
        f"/generation/tasks/{task_id}?project_id={project['id']}",
    ).json()["data"]
    assert task["input_payload"]["model_3d_url"] == "https://cdn.example.com/outfits/hanfu.glb"
    assert task["input_payload"]["outfit_id"] == OUTFIT


def test_web_layer_does_not_guess_an_outfit_when_none_is_given(auth_client, db_session):
    """没给 outfit_id 就不许挑一个造型顶上 —— 猜错等于拿另一套衣服渲这次的动作,
    而帧数、时长、成色全部正常,没有任何一道会红。"""
    from conftest import seed_credit_account

    seed_credit_account(db_session, 1)
    db_session.commit()

    project = auth_client.post("/projects", json={
        "project_name": "三渲二", "character_perspective": 1, "directional_movement": 2,
        "sprite_width": 64, "sprite_height": 64,
    }).json()["data"]
    character = auth_client.post("/characters", json={
        "project_id": project["id"], "workflow_run_id": 1, "name": "勇者",
        "character_data": {"version": 1, "outfits": [{
            "id": OUTFIT, "name": "汉服",
            "model_3d_url": "https://cdn.example.com/outfits/hanfu.glb", "actions": [],
        }]},
    }).json()["data"]

    resp = auth_client.post("/generation/action", json={
        "project_id": project["id"], "character_id": character["id"],
        "action_type": "walk", "num_frames": 4,
        # 没给 outfit_id 就走 i2v,而 i2v 要母版才收单(_require_master);带上它,
        # 这个用例才停在"路线选择"这个题上。
        "reference_image_urls": ["https://cdn.example.com/masters/hero.png"],
    })

    task_id = resp.json()["data"]["id"]
    task = auth_client.get(
        f"/generation/tasks/{task_id}?project_id={project['id']}",
    ).json()["data"]
    assert task["input_payload"]["model_3d_url"] is None


def test_unknown_outfit_id_is_rejected_not_ignored(auth_client):
    """造型 id 对不上要报错。静默当成"没有资产"会让用户以为三渲二不可用,
    实际是他把 id 打错了。"""
    project = auth_client.post("/projects", json={
        "project_name": "三渲二", "character_perspective": 1, "directional_movement": 2,
        "sprite_width": 64, "sprite_height": 64,
    }).json()["data"]
    character = auth_client.post("/characters", json={
        "project_id": project["id"], "workflow_run_id": 1, "name": "勇者",
        "character_data": {"version": 1, "outfits": []},
    }).json()["data"]

    resp = auth_client.post("/generation/action", json={
        "project_id": project["id"], "character_id": character["id"],
        "action_type": "walk", "num_frames": 4, "outfit_id": "不存在的造型",
    })
    assert resp.json()["code"] == 404


# ══ ② 引擎侧:路线选择不归它管 ════════════════════════════════════════════


def test_engine_has_no_route_field_to_be_told_which_route_to_take():
    """``ActionSpec.route`` 已删(#122):路线选择整个移到 server,这个字段零消费方。

    留着一个"填了看起来会生效、实际没人读"的入参,正是本仓反复吃过的那类错。
    """
    with pytest.raises(Exception):
        ActionSpec(action=ActionType.WALK, n_frames=4, route=GenRoute.RENDER_3D)


def test_render3d_is_not_in_the_route_matrix():
    """三渲二不进 ROUTE_MATRIX —— 那张表的前提是"路线由动作物理性质唯一决定",
    而走不走三渲二取决于造型有没有 3D 资产。塞进去就破了它的前提。"""
    from windup_ai_engine.strategy.base import ROUTE_MATRIX

    assert GenRoute.RENDER_3D not in ROUTE_MATRIX.values()


def test_generate_rendered_raises_when_the_route_is_not_assembled():
    """没装 RENDER_3D 的 strategy 就在边界上炸,不静默回退到 i2v。"""
    gen = CharacterGenerator({GenRoute.VIDEO_I2V: VideoFrameStrategy(video=None, matte=None)})
    with pytest.raises(NotImplementedError, match="render_3d"):
        gen.generate_rendered(_card(), _spec(), b"RIGGED", _NullProgress())


def test_empty_model_bytes_raise_before_the_render_stage():
    """空模型必须在策略入口炸。放下去的话出帧台会报一句"Bad glTF",排查方向全跑偏。"""
    renderer = _FakeRenderer()
    with pytest.raises(ValueError, match="空的绑骨模型"):
        RenderFrameStrategy(renderer).derive(_card(), _spec(), b"", _NullProgress())
    assert renderer.calls == 0


# ══ ③ 多朝向:如实上报,不闷掉 ════════════════════════════════════════════


def test_requested_facing_picks_the_matching_direction():
    renderer = _FakeRenderer(directions=("e", "n"))
    spy = _SpyProgress()
    RenderFrameStrategy(renderer).derive(
        _card(), _spec(facing=Facing.FRONT), b"RIGGED", spy,
    )
    assert any("朝向 n" in n or "只带 n" in n for n in spy.notes), spy.notes


def test_missing_direction_raises_instead_of_handing_back_another():
    """出帧台没出请求的朝向就报错。换一个交出去 = 角色朝反方向走,而没有任何一道会红。"""
    renderer = _FakeRenderer(directions=("w", "s"))
    with pytest.raises(ValueError, match="没有产出朝向"):
        RenderFrameStrategy(renderer).derive(_card(), _spec(), b"RIGGED", _NullProgress())


def test_extra_directions_are_reported_not_silently_dropped():
    """多渲出来的朝向零成本、但出参装不下 —— 这笔浪费要**可见**。"""
    spy = _SpyProgress()
    RenderFrameStrategy(_FakeRenderer(directions=("e", "n", "w", "s"))).derive(
        _card(), _spec(), b"RIGGED", spy,
    )
    assert any("零成本可用但当前契约装不下" in n for n in spy.notes), spy.notes


def test_render_uses_the_measured_portrait_canvas():
    """出帧台画布用挣来的那个口径(竖图),不是随手一个方形。"""
    from windup_framework.providers.render3d import RENDER_SIZE

    renderer = _FakeRenderer()
    RenderFrameStrategy(renderer).derive(_card(), _spec(), b"RIGGED", _NullProgress())
    assert renderer.last_size == RENDER_SIZE


def test_empty_render_output_raises():
    class _EmptyRenderer(_FakeRenderer):
        def render(self, rigged_model, **kw) -> SpriteSheet:
            return SpriteSheet(
                clip="walk", duration_s=1.0, sample_times=[],
                sequences=[SpriteSequence(direction="e", camera_yaw=0.0, frames=[])],
                rig=RigInfo(bones=1, skinned_meshes=1, vertices=1, root_bone="Hips",
                            loader="glb"),
                available_clips={"walk": 1.0},
            )

    with pytest.raises(ValueError, match="未产出任何帧"):
        RenderFrameStrategy(_EmptyRenderer()).derive(
            _card(), _spec(), b"RIGGED", _NullProgress(),
        )


# ══ ④ 成本性质:造型级资产每造型一次性 ════════════════════════════════════


def test_second_action_reuses_assets_and_pays_nothing_extra(tmp_path):
    builder, m, r = _builder(tmp_path)
    builder.ensure(OUTFIT, _png(), _NullProgress())
    builder.ensure(OUTFIT, _png(), _NullProgress())
    assert (m.calls, r.calls) == (1, 1), "图生 3D / 绑骨按动作重付了"


def test_assets_survive_a_new_builder_instance(tmp_path):
    """落点必须跨进程持久 —— 进程内缓存等于每次重启都重付一遍。"""
    b1, m1, r1 = _builder(tmp_path)
    b1.ensure(OUTFIT, _png(), _NullProgress())
    b2, m2, r2 = _builder(tmp_path)
    b2.ensure(OUTFIT, _png(), _NullProgress())
    assert (m2.calls, r2.calls) == (0, 0)


def test_different_outfits_do_not_share_a_model(tmp_path):
    """不同造型是不同外观,共用一个 3D 模型 = 拿错衣服渲,而没有任何一道会红。"""
    builder, m, r = _builder(tmp_path)
    builder.ensure(OUTFIT, _png(), _NullProgress())
    builder.ensure("outfit-armor-02", _png(), _NullProgress())
    assert (m.calls, r.calls) == (2, 2)


def test_missing_outfit_key_raises_before_spending(tmp_path):
    builder, m, r = _builder(tmp_path)
    with pytest.raises(ValueError, match="缺少造型 id"):
        builder.ensure("", _png(), _NullProgress())
    assert (m.calls, r.calls) == (0, 0)


def test_get_costs_nothing(tmp_path):
    """``get`` 是 server 选路线时调的,必须不花钱、无副作用。"""
    builder, m, r = _builder(tmp_path)
    assert builder.get(OUTFIT) is None
    assert (m.calls, r.calls) == (0, 0)


# ══ ⑤ 花钱要有人点头 ═════════════════════════════════════════════════════


def test_default_posture_refuses_to_build_assets(tmp_path):
    """默认不授权花钱:一个 web 请求不该顺手触发按次计费。"""
    builder, m, r = _builder(tmp_path, may_build=False)
    with pytest.raises(ValueError, match="未获准建"):
        builder.ensure(OUTFIT, _png(), _NullProgress())
    assert (m.calls, r.calls) == (0, 0)


def test_default_posture_still_serves_outfits_that_already_have_assets(tmp_path):
    """已有资产的造型照常出帧 —— 默认档挡的是"建",不是"用"。"""
    b1, _, _ = _builder(tmp_path, may_build=True)
    b1.ensure(OUTFIT, _png(), _NullProgress())
    b2, m2, r2 = _builder(tmp_path, may_build=False)
    assert b2.ensure(OUTFIT, _png(), _NullProgress()) == b"RIGGED-bytes"
    assert (m2.calls, r2.calls) == (0, 0)


# ══ ⑥ 生成的 3D 模型必须先给人看过才往下走 ═══════════════════════════════


class _NeverApprove(_AutoApproveReview):
    def is_approved(self, key: str) -> bool:
        return False


def test_model_awaits_review_before_paying_for_rigging(tmp_path):
    """停点在图生 3D 之后、绑骨之前:信息最全而花费最少的位置。"""
    builder, m, r = _builder(tmp_path, review=_NeverApprove())
    with pytest.raises(ModelAwaitingReview):
        builder.ensure(OUTFIT, _png(), _NullProgress())
    assert (m.calls, r.calls) == (1, 0), "还没人点头就把绑骨的钱花了"


def test_waiting_for_review_does_not_repay_image_to_3d(tmp_path):
    """待审期间反复调用不该重付图生 3D —— 停点的本意恰恰是省钱。"""
    builder, m, _ = _builder(tmp_path, review=_NeverApprove())
    for _ in range(3):
        with pytest.raises(ModelAwaitingReview):
            builder.ensure(OUTFIT, _png(), _NullProgress())
    assert m.calls == 1


def test_review_never_self_approves(tmp_path):
    """放行只能靠人手动建标记文件。超时自动放行的闸等于没有闸。"""
    gate = LocalDirModelReview(tmp_path / "review")
    gate.submit(OUTFIT, b"GLB", "GLB")
    assert gate.is_approved(OUTFIT) is False
    gate.approve(OUTFIT)
    assert gate.is_approved(OUTFIT) is True


def test_after_approval_it_proceeds_and_reuses_the_stored_model(tmp_path):
    """人点头之后继续绑骨,且**不重付**图生 3D(待审期间那份已经存下来了)。"""
    store = LocalDirAssetStore(tmp_path)
    gate = LocalDirModelReview(tmp_path / "review")
    m, r = _FakeModel3D(), _FakeAutoRig()
    builder = Render3DAssetBuilder(
        model3d=m, autorig=r, store=store, review=gate, may_build_assets=True,
    )
    with pytest.raises(ModelAwaitingReview):
        builder.ensure(OUTFIT, _png(), _NullProgress())
    gate.approve(OUTFIT)
    assert builder.ensure(OUTFIT, _png(), _NullProgress()) == b"RIGGED-bytes"
    assert (m.calls, r.calls) == (1, 1)
