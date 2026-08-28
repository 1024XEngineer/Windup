"""三渲二**能不能出动作**这条链上的四个静默缺陷。

这一片全部是"不报错、只出错东西"的类型,所以每条用例都从"它拦住了哪个真实坏例"写起:

  ① **绑骨请求体里没有 MotionType。** 接口照样受理、照样扣 10 积分,产物只是零个
     AnimationStack(实测:带 walk 的产物 1 个,不带的 0 个;图生 3D 的原始模型也是 0 个)。
     绑骨"成功"、格式对、28 骨对、体积对,出帧台却拿到零片段 —— 没有任何一道会红。
  ② **零动画的产物被存成 READY。** 落点里有 bytes 就是"资产已就绪",于是 10 积分买来
     一个哑模型挂在造型上,用户看到的是"三渲二根本出不了动作"。
  ③ **FBX 挂成 .glb 发出去。** 绑骨接口即便被要求 GLB 也返回 FBX,而两个出帧台宿主都
     按 URL 后缀挑 loader —— 后缀骗了 loader,报一句 "Bad glTF",排查方向整个跑偏。
  ④ **拿走路帧当攻击交付。** 一份绑骨产物只带一个动作片段,那唯一一个片段照样渲得满
     32 张帧;帧数、时长、朝向、成色全部自洽。
"""
from __future__ import annotations

import pathlib

import pytest

from windup_app.server.orchestrator.client_bake import ActionAwaitingClientBake
from windup_app.server.orchestrator.executor import ActionTaskExecutor, ProjectConstraints
from windup_app.server.orchestrator.model import ActionType as InputActionType
from windup_app.server.orchestrator.model import CharacterActionInput
from windup_app.server.orchestrator.render3d_assets import (
    ACTION_MOTIONS,
    BUILD_MOTION,
    RENDERABLE_ACTIONS,
    LocalDirAssetStore,
    Render3DAssetBuilder,
    Render3DAssetState,
)
from windup_common.models import GenRoute

try:
    from windup_framework.providers.render3d import PRESET_MOTIONS, RiggedModel
    from windup_framework.providers.render3d import tencent as tencent_mod
except ModuleNotFoundError as exc:                      # pragma: no cover - 缺件时整体跳过
    pytest.skip(f"缺 {exc.name}(三渲二 provider 层)", allow_module_level=True)


GLB_BYTES = b"glTF" + b"\x02\x00\x00\x00" + b"fake-model-payload"
FBX_BYTES = b"Kaydara FBX Binary  \x00" + b"fake-rigged-payload"
OUTFIT_KEY = "character-1/outfit-default"


class _NullProgress:
    def step(self, stage: str, i: int, total: int, note: str = "") -> None:
        pass


class _AutoApproveReview:
    """只用于不测人工确认闸的用例 —— 那道闸本身在 test_render3d_asset_endpoints 里有专门用例。"""

    def submit(self, key: str, model: bytes, fmt: str) -> str:
        return f"<fake>/{key}.{fmt.lower()}"

    def is_approved(self, key: str) -> bool:
        return True


class _FakeModel3D:
    def image_to_3d(self, master: bytes, *, want: str = "GLB", extra_views=None) -> bytes:
        return GLB_BYTES


# ══ ① 绑骨请求体里到底有没有 MotionType ═══════════════════════════════════════


def test_build_puts_motiontype_in_the_actual_rig_request(tmp_path: pathlib.Path, monkeypatch):
    """从"点建资产"一路走到**发给腾讯的那个 params**,里面必须有 MotionType。

    拦的坏例:``Render3DAssetBuilder`` 调 ``rig(model, want="GLB")`` 不传 ``motion``,
    于是 ``resolve_motion(None)`` 回 None、``_submit`` 里那个 ``if preset is not None``
    不成立、请求体里根本没有 MotionType。绑骨照样成功、照样扣费,产物零动画。

    **本用例刻意用真的 TencentAutoRigProvider**,只把网络那一层换掉:替身 provider 只能
    证明"builder 传了一个叫 motion 的参数",证明不了"它最后变成了请求体里的 MotionType"
    —— 而这条链上任何一环断掉,症状都一模一样。
    """
    sent: list[tuple[str, dict]] = []

    def fake_call(action: str, params: dict, **_kw) -> dict:
        sent.append((action, params))
        if action == "SubmitAutoRiggingJob":
            return {"JobId": "job-1"}
        return {"Status": "DONE", "ResultFile3Ds": [{"Type": "FBX", "Url": "https://c.test/r.fbx"}]}

    monkeypatch.setattr(tencent_mod, "call", fake_call)
    monkeypatch.setattr(tencent_mod, "_download", lambda url, **_kw: FBX_BYTES)

    class _Uploader:
        def upload(self, model: bytes, content_type: str) -> str:
            return "https://cos.test/model.glb"

    autorig = tencent_mod.TencentAutoRigProvider(
        _Uploader(),
        tencent_mod.TencentCredentials("fake-id", "fake-key"),
        allow_spend=True,
        precheck=False,                        # 预检本身另有用例;这里测的是请求体
    )
    builder = Render3DAssetBuilder(
        model3d=_FakeModel3D(),
        autorig=autorig,
        store=LocalDirAssetStore(tmp_path / "assets"),
        review=_AutoApproveReview(),
        may_build_assets=True,
    )

    data = builder.ensure(OUTFIT_KEY, b"master-png", _NullProgress())

    submits = [params for action, params in sent if action == "SubmitAutoRiggingJob"]
    assert len(submits) == 1
    assert submits[0].get("MotionType") == PRESET_MOTIONS[BUILD_MOTION].motion_type, (
        f"绑骨请求体里没有 MotionType(实际 {submits[0]!r})—— 接口会照样成功、照样扣 "
        "10 积分,只是产物零动画,而帧数/时长/成色下游全部正常"
    )
    assert data == FBX_BYTES


# ══ ② 零动画的产物不许当成就绪资产 ═════════════════════════════════════════════


class _MuteAutoRig:
    """回一个没有动作片段的绑骨产物 —— 真接口在缺 MotionType 时就是这样。"""

    def __init__(self) -> None:
        self.calls = 0

    def rig(self, model: bytes, *, want: str = "GLB", motion=None) -> RiggedModel:
        self.calls += 1
        return RiggedModel(data=FBX_BYTES, fmt="FBX", motion=None)


def test_rigged_model_without_animation_never_becomes_a_ready_asset(tmp_path: pathlib.Path):
    """绑骨产物里没有动作片段就抛,且**不落点**。

    拦的坏例:哑模型被存下来 → ``state()`` 变 READY → ``model_3d_url`` 回写到造型上 →
    之后每个动作任务都被路由到三渲二,而出帧台一个片段都找不到。10 积分买了一个
    永远出不了帧的资产,且没有一处报错指向绑骨。
    """
    store = LocalDirAssetStore(tmp_path / "assets")
    builder = Render3DAssetBuilder(
        model3d=_FakeModel3D(),
        autorig=_MuteAutoRig(),
        store=store,
        review=_AutoApproveReview(),
        may_build_assets=True,
    )

    with pytest.raises(RuntimeError, match="没有动作片段"):
        builder.ensure(OUTFIT_KEY, b"master-png", _NullProgress())

    assert store.get(OUTFIT_KEY) is None
    assert builder.state(OUTFIT_KEY) is Render3DAssetState.AWAITING_REVIEW, (
        "哑模型不该把造型推进 READY —— 图生 3D 的产物还在待审位上,重试只需再付绑骨"
    )


# ══ ③ 发出去的 URL 后缀要说真话 ═══════════════════════════════════════════════


@pytest.mark.parametrize(
    ("data", "suffix", "content_type"),
    [
        (FBX_BYTES, ".fbx", "application/x-fbx"),
        (GLB_BYTES, ".glb", "model/gltf-binary"),
    ],
)
def test_published_model_url_keeps_the_real_container_format(
    monkeypatch, data: bytes, suffix: str, content_type: str
):
    """绑骨产物按 magic bytes 定后缀,不写死 ``.glb``。

    拦的坏例:绑骨接口即便被要求 GLB 也返回 FBX(归档里每一份绑骨产物都是 FBX),而
    ``_publish_model`` 恒用 ``rigged.glb`` 当文件名 → 对象键以 ``.glb`` 结尾 → 出帧台
    按后缀挑到 GLTFLoader → "Bad glTF: json error"。症状看起来像出帧台坏了,
    而钱在两步之前就花完了。
    """
    from windup_app.server.media import service as media_service_mod
    from windup_app.server.orchestrator.render3d_service import _publish_model

    seen: list[object] = []

    class _Result:
        url = "https://cdn.test/media/model-3d/deadbeef"

    class _Media:
        def upload(self, payload: bytes, metadata):
            seen.append(metadata)
            return _Result()

    monkeypatch.setattr(media_service_mod, "service", _Media())
    _publish_model(data)

    assert seen[0].filename.endswith(suffix)
    assert seen[0].content_type == content_type


# ══ ④ 资产没烘的动作不许派单 ═════════════════════════════════════════════════


def _executor() -> ActionTaskExecutor:
    from windup_ai_engine.impl import CharacterGenerator
    from windup_ai_engine.strategy.concrete import RenderFrameStrategy

    return ActionTaskExecutor(
        generator=CharacterGenerator({GenRoute.RENDER_3D: RenderFrameStrategy(None, directions=4)}),
        upload=lambda _png: pytest.fail("还没出帧就上传了"),
        fetch_master=lambda _input: pytest.fail("走三渲二不该去下载母版"),
        fetch_model3d=lambda url: pytest.fail("出帧交给浏览器了,应用机不该再下模型"),
        fetch_constraints=lambda *_: ProjectConstraints(sprite_w=64, sprite_h=64),
    )


def _input(action: InputActionType) -> CharacterActionInput:
    return CharacterActionInput(
        character_id=1,
        action_type=action,
        num_frames=4,
        outfit_id="outfit-default",
        model_3d_url="https://cdn.test/media/model-3d/rigged.fbx",
    )


@pytest.fixture
def _no_dispatch(monkeypatch):
    """把出帧登记换成内存桩,顺便证明"被拒的动作一次都没登记过"。"""
    jobs: dict[int, object] = {}
    monkeypatch.setattr(
        "windup_app.server.orchestrator.client_bake.open_job",
        lambda task_id, spec: jobs.setdefault(task_id, spec) and 0.0,
    )
    monkeypatch.setattr("windup_app.server.orchestrator.executor.is_own_media", lambda url: True)
    return jobs


def test_action_the_asset_never_baked_is_refused_before_dispatch(_no_dispatch):
    """资产只烘了 walk,attack 任务在**派单之前**被拒,而不是渲出一段走路。

    拦的坏例:模型里那唯一一个片段(名字是绑骨任务的哈希)照样渲得满 32 张帧,于是
    攻击动作交付的是一段走路 —— 帧数、时长、朝向、成色全部自洽,没有一道会红。
    """
    with pytest.raises(ValueError, match="只烘了"):
        _executor()._produce_action(
            _input(InputActionType.ATTACK),
            ProjectConstraints(sprite_w=64, sprite_h=64),
            task_id=21,
        )
    assert not _no_dispatch, "被拒的动作居然还登记了出帧任务"


def test_the_baked_action_still_gets_dispatched(_no_dispatch):
    """反向对照:资产烘的那个动作照常派单 —— 上一条拒的是动作,不是整条路线。"""
    with pytest.raises(ActionAwaitingClientBake):
        _executor()._produce_action(
            _input(InputActionType.WALK),
            ProjectConstraints(sprite_w=64, sprite_h=64),
            task_id=22,
        )
    assert 22 in _no_dispatch


# ══ 映射表本身 ═══════════════════════════════════════════════════════════════


def test_action_motion_table_covers_every_entry_action_and_names_only_real_presets():
    """入口枚举的每个动作都要在表里有明确条目,且映射到的名字必须是 provider 认识的。

    拦的两个坏例:
      · 新增一个 ActionType 却忘了在表里表态 —— 它会被当成"不支持",这是安全的方向,
        但表要显式写出来,否则读表的人以为漏了;
      · 映射到一个 PRESET_MOTIONS 里不存在的名字(打错字、或凭文档猜一个编号名)——
        ``resolve_motion`` 会抛 KeyError,而那一刻图生 3D 的 20 积分已经花完、
        模型也已经过了人工确认。
    """
    assert set(ACTION_MOTIONS) == {a.value for a in InputActionType}
    for action, motion in ACTION_MOTIONS.items():
        if motion is not None:
            assert motion in PRESET_MOTIONS, f"{action} 映射到未登记的预设 {motion!r}"
    assert BUILD_MOTION in PRESET_MOTIONS
    assert RENDERABLE_ACTIONS, "一个动作都出不了的路线等于没有路线"
