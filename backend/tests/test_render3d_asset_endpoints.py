"""建 3D 资产的四个端点:看状态 / 建 / 放行 / 否掉。

锁的是**钱和闸**,不是"能返回 200":

  ① 按次计费的触发点只有一个,且成本恒在返回里 —— 用户不可能在不知情时触发;
  ② 人工确认闸不点头就不绑骨。这道闸一旦能自动放行,一个坏模型会连带浪费绑骨的
     10 积分和之后所有出帧,而人要看完一整套序列帧才发现锅在最上游;
  ③ 母版没过预检就不许花钱建 —— 母版 ¥0.29、模型 ¥2.40,错要在便宜的地方纠。
"""
from __future__ import annotations

import io
import pathlib

import pytest
from PIL import Image

from windup_app.server.orchestrator.render3d_assets import (
    BUILD_CREDITS,
    LocalDirAssetStore,
    LocalDirModelReview,
    Render3DAssetBuilder,
)
from windup_app.server.orchestrator.render3d_service import Render3DAssetOperations
from windup_app.server.character.model import Character
from windup_app.server.project.model import Project

MASTER_URL = "https://cdn.windup.test/media/reference-image/master.png"
OUTFIT_ID = "outfit-default"


def _master_png(*, legs_apart: bool = True) -> bytes:
    """一个能过预检的人形。腿之间那道空隙决定 ``limb_segments``。"""
    img = Image.new("RGBA", (200, 400), (0, 0, 0, 0))
    px = img.load()

    def block(x0, y0, x1, y1):
        for y in range(y0, y1):
            for x in range(x0, x1):
                px[x, y] = (40, 40, 60, 255)

    block(80, 40, 120, 100)
    block(70, 100, 130, 240)
    block(74, 240, 94, 380)
    block(106, 240, 126, 380)
    if not legs_apart:
        block(94, 240, 106, 380)
    buf = io.BytesIO()
    img.save(buf, "PNG")
    return buf.getvalue()


class _FakeModel3D:
    """图生 3D 的替身。**记账**:调了几次就是花了几次钱。"""

    def __init__(self) -> None:
        self.calls = 0

    def image_to_3d(self, master: bytes, *, want: str = "GLB") -> bytes:
        self.calls += 1
        return b"glTF-fake-model"


class _FakeAutoRig:
    def __init__(self) -> None:
        self.calls = 0

    def rig(self, model: bytes, *, want: str = "GLB", motion=None):
        self.calls += 1
        return _Rigged(model + b"-rigged", "GLB")


class _Rigged:
    def __init__(self, data: bytes, fmt: str) -> None:
        self.data, self.fmt = data, fmt


@pytest.fixture()
def render3d(tmp_path: pathlib.Path):
    """就地跑完的 operations —— 不起线程,用例不必等收敛。

    等线程的用例会变成偶发失败,而偶发失败最后都会被人当噪音忽略。
    """
    model3d, autorig = _FakeModel3D(), _FakeAutoRig()
    store = LocalDirAssetStore(tmp_path / "assets")
    builder = Render3DAssetBuilder(
        model3d=model3d,
        autorig=autorig,
        store=store,
        review=LocalDirModelReview(tmp_path / "review"),
        may_build_assets=True,
    )
    published: list[bytes] = []

    def publish(data: bytes) -> str:
        published.append(data)
        return f"https://cdn.windup.test/media/model-3d/{len(published)}.glb"

    source = {"master": _master_png()}          # 用例要换母版时改这里,不碰私有属性
    operations = Render3DAssetOperations(
        builder, store, publish,
        fetch=lambda url: source["master"],
        spawn=lambda work: work(),
    )
    operations.test_model3d = model3d           # 用例要按住"调了几次"
    operations.test_autorig = autorig
    operations.test_source = source
    return operations


@pytest.fixture()
def api(auth_client, engine, render3d):
    """带一个已确认定妆母版的造型的角色 + 装好替身的 app。"""
    auth_client.app.state.render3d_operations = render3d
    from sqlalchemy.orm import sessionmaker

    session = sessionmaker(bind=engine)()
    session.add(Project(id=1, user_id=1, project_name="p", character_perspective=1,
                        directional_movement=1, sprite_width=64, sprite_height=64))
    session.add(Character(
        id=7, project_id=1, workflow_run_id=1, name="仙月",
        character_data={"version": 1, "outfits": [
            {"id": OUTFIT_ID, "name": "常态造型", "description": None,
             "preview_url": MASTER_URL, "model_3d_url": None, "actions": []},
        ]},
        status=0,
    ))
    session.commit()
    session.close()
    return auth_client


def _base(outfit_id: str = OUTFIT_ID) -> str:
    return f"/render3d/characters/7/outfits/{outfit_id}"


def _data(response) -> dict:
    body = response.json()
    assert body["code"] == 200, body
    return body["data"]


# ── ① 成本:用户不可能在不知情时触发按次计费 ──────────────────────────────


def test_status_always_carries_the_cost_even_before_anything_is_built(api, render3d):
    data = _data(api.get(_base()))
    assert data["state"] == "absent"
    assert data["cost"]["model3d_credits"] == 20
    assert data["cost"]["autorig_credits"] == 10
    assert data["cost"]["total_credits"] == BUILD_CREDITS
    assert data["cost"]["total_cny"] == pytest.approx(3.60)
    assert data["cost"]["scope"] == "per_outfit_once"
    assert render3d.test_model3d.calls == 0     # 看一眼状态不花钱


def test_reading_status_is_free_no_matter_how_often(api, render3d):
    for _ in range(5):
        api.get(_base())
    assert render3d.test_model3d.calls == 0
    assert render3d.test_autorig.calls == 0


def test_cost_numbers_come_from_the_billing_implementation(api):
    """成本不是前端抄的常量。改了计费实现而这里没跟着变,说明有人抄了一份数字 ——
    抄的那一份正是给用户看的,告知错的价钱比不告知更糟。"""
    from windup_framework.providers.render3d.tencent import (
        CREDIT_PRICE_CNY,
        CREDITS,
        RIG_CREDITS,
    )

    cost = _data(api.get(_base()))["cost"]
    assert cost["model3d_credits"] == CREDITS["Normal"]
    assert cost["autorig_credits"] == RIG_CREDITS
    assert cost["total_cny"] == pytest.approx(
        (CREDITS["Normal"] + RIG_CREDITS) * CREDIT_PRICE_CNY, abs=0.005
    )


# ── ② 人工确认闸 ────────────────────────────────────────────────────────────


def test_build_stops_at_the_review_gate_without_rigging(api, render3d):
    """建完 ① 就停。**绑骨一次都不许调** —— 这道闸的全部价值就在这里。"""
    data = _data(api.post(f"{_base()}/build"))
    assert data["state"] == "awaiting_review"
    assert render3d.test_model3d.calls == 1
    assert render3d.test_autorig.calls == 0
    assert _data(api.get(_base()))["state"] == "awaiting_review"


def test_waiting_at_the_gate_forever_never_auto_approves(api, render3d):
    """反复查状态不会把闸熬开。超时自动放行的闸等于没有闸,只是把"没人看"伪装成
    "看过了"。"""
    api.post(f"{_base()}/build")
    for _ in range(10):
        assert _data(api.get(_base()))["state"] == "awaiting_review"
    assert render3d.test_autorig.calls == 0


def test_awaiting_review_hands_out_a_link_to_the_model(api):
    """待审模型必须能取到。只躺在服务器磁盘上的话,人点"通过"时其实一眼都没看到,
    闸就退化成一个必须点的按钮 —— 比没有闸更糟,它制造了"已经审过"的假象。"""
    data = _data(api.post(f"{_base()}/build"))
    assert data["review_model_url"], "待审模型没有可打开的地址"
    assert data["model_3d_url"] is None, "还没绑骨,不该有可用的绑骨模型"


def test_discarding_also_drops_the_review_link(api):
    api.post(f"{_base()}/build")
    assert _data(api.post(f"{_base()}/discard"))["review_model_url"] is None


def test_approve_is_what_starts_rigging(api, render3d):
    api.post(f"{_base()}/build")
    data = _data(api.post(f"{_base()}/approve"))
    assert data["state"] == "ready"
    assert render3d.test_autorig.calls == 1
    assert data["model_3d_url"]


def test_approving_before_there_is_a_model_is_refused(api, render3d):
    body = api.post(f"{_base()}/approve").json()
    assert body["code"] == 400
    assert render3d.test_autorig.calls == 0


def test_discard_sends_it_back_to_absent_and_the_next_build_regenerates(api, render3d):
    """不合格 → 丢弃 → 重新生成。混元的模型改不动,这是唯一的补救。"""
    api.post(f"{_base()}/build")
    assert _data(api.post(f"{_base()}/discard"))["state"] == "absent"
    assert render3d.test_autorig.calls == 0

    assert _data(api.post(f"{_base()}/build"))["state"] == "awaiting_review"
    assert render3d.test_model3d.calls == 2      # 重新生成要再付一次图生 3D


def test_discard_after_a_failed_rig_clears_the_approval_marker(api, render3d):
    """绑骨失败后模型还卡在闸上、而批准标记已经留下了。此时否掉必须把标记一起删 ——
    留着的话,下一次生成出来的新模型会被这枚旧标记直接放行,人一眼都没看到就进了绑骨。"""
    def _boom(model: bytes, *, want: str = "GLB", motion=None):
        render3d.test_autorig.calls += 1
        raise RuntimeError("绑骨服务 500")

    api.post(f"{_base()}/build")
    render3d.test_autorig.rig = _boom
    api.post(f"{_base()}/approve")
    assert render3d.test_autorig.calls == 1

    assert _data(api.post(f"{_base()}/discard"))["state"] == "absent"
    render3d.test_autorig.rig = _FakeAutoRig().rig.__get__(render3d.test_autorig)
    assert _data(api.post(f"{_base()}/build"))["state"] == "awaiting_review", (
        "新模型被旧的批准标记放行了"
    )


# ── ③ 复用:每造型一次性,不是每动作一次 ────────────────────────────────────


def test_building_twice_is_refused_instead_of_paying_again(api, render3d):
    api.post(f"{_base()}/build")
    assert api.post(f"{_base()}/build").json()["code"] == 400
    assert render3d.test_model3d.calls == 1


def test_ready_asset_is_not_rebuilt(api, render3d):
    api.post(f"{_base()}/build")
    api.post(f"{_base()}/approve")
    assert api.post(f"{_base()}/build").json()["code"] == 400
    assert render3d.test_model3d.calls == 1
    assert render3d.test_autorig.calls == 1


def test_ready_asset_writes_the_url_back_onto_the_outfit(api, engine):
    """不回写的话,三渲二的判据(``outfits[].model_3d_url``)永远是 None ——
    资产建好了,前端依旧显示"该造型暂无绑骨 3D 模型",钱白花。"""
    api.post(f"{_base()}/build")
    api.post(f"{_base()}/approve")
    api.get(_base())                              # 回写发生在读状态这一步

    from sqlalchemy.orm import sessionmaker

    session = sessionmaker(bind=engine)()
    stored = session.get(Character, 7)
    outfit = stored.character_data["outfits"][0]
    session.close()
    assert outfit["model_3d_url"], "建好的模型 URL 没落到造型上"


# ── ④ 母版预检把关花钱那一步 ────────────────────────────────────────────────


def test_unusable_master_is_refused_before_any_paid_call(api, render3d):
    """空白母版 → 拒绝建。母版 ¥0.29、模型 ¥2.40,错要在便宜的地方纠。"""
    blank = Image.new("RGBA", (200, 200), (0, 0, 0, 0))
    buf = io.BytesIO()
    blank.save(buf, "PNG")
    render3d.test_source["master"] = buf.getvalue()

    assert api.post(f"{_base()}/build").json()["code"] == 400
    assert render3d.test_model3d.calls == 0


def test_a_warned_but_usable_master_still_builds(api, render3d):
    """警告不拦路:两条警告判据都会在合法母版上误报(侧视角色两腿必然重叠),
    拿它们挡路等于把误报变成挡住用户的钱。"""
    render3d.test_source["master"] = _master_png(legs_apart=False)
    assert _data(api.post(f"{_base()}/build"))["state"] == "awaiting_review"
    assert render3d.test_model3d.calls == 1


def test_precheck_endpoint_reports_facts_and_warnings_without_spending(api, render3d):
    api.app.state.precheck_master = lambda url, canvas=None: {
        "accepted": True, "reject_code": None, "detail": "ok",
        "facts": {"limb_segments": [1, 1, 1, 1]},
        "warnings": [{"code": "limbs_fused", "detail": "两腿量不到空隙"}],
    }
    data = _data(api.post("/render3d/master-precheck", json={"image_url": MASTER_URL}))
    assert data["accepted"] is True
    assert data["warnings"][0]["code"] == "limbs_fused"
    assert render3d.test_model3d.calls == 0


# ── ⑤ 归属与键 ──────────────────────────────────────────────────────────────


def test_unknown_outfit_is_not_found(api):
    assert api.get(_base("outfit-nope")).json()["code"] == 404


def test_other_users_character_is_not_reachable(auth_client_b, api):
    assert auth_client_b.get(_base()).json()["code"] == 404


def test_asset_key_is_namespaced_by_character(api, render3d, engine):
    """``outfit-default`` 是工作流写死给首个造型的 id。只用它当落点键的话,
    全站每个角色的默认造型会共用同一个 3D 模型,且没有任何报错。"""
    api.post(f"{_base()}/build")
    from sqlalchemy.orm import sessionmaker

    session = sessionmaker(bind=engine)()
    session.add(Character(
        id=8, project_id=1, workflow_run_id=2, name="另一个",
        character_data={"version": 1, "outfits": [
            {"id": OUTFIT_ID, "name": "常态造型", "description": None,
             "preview_url": MASTER_URL, "model_3d_url": None, "actions": []},
        ]},
        status=0,
    ))
    session.commit()
    session.close()

    other = api.get(f"/render3d/characters/8/outfits/{OUTFIT_ID}")
    assert _data(other)["state"] == "absent", "另一个角色的默认造型不该套用这一个的模型"
