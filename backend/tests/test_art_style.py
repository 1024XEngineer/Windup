"""项目画风枚举:存量兼容、入参约束、以及它对生成约束的影响。"""

import pytest

from windup_common.enums import ArtStyle


def _payload(**overrides):
    base = {
        "project_name": "画风",
        "character_perspective": 1,
        "directional_movement": 2,
        "sprite_width": 64,
        "sprite_height": 64,
    }
    base.update(overrides)
    return base


# -- 存量兼容 ----------------------------------------------------------------


@pytest.mark.parametrize(
    "stored, wants_pixel",
    [
        # 生产库里实际出现过的两种取值(133 个项目里 9 个填了画风,只有这两种)
        ("像素风格", True),
        ("像素风", True),
        ("pixel art", True),
        ("Pixel Art", True),
        ("中世纪写实", False),
        ("", False),
        (None, False),
    ],
)
def test_legacy_free_text_keeps_the_branch_it_used_to_take(stored, wants_pixel):
    """枚举化不能改变已建项目走哪一支 —— 那种改变不会让任何一处报错。"""
    assert ArtStyle.from_stored(stored).wants_pixelation is wants_pixel


def test_stored_enum_value_round_trips():
    for style in ArtStyle:
        assert ArtStyle.from_stored(style.value) is style


def test_only_pixel_turns_on_pixelation():
    assert [s for s in ArtStyle if s.wants_pixelation] == [ArtStyle.PIXEL]


def test_every_style_but_unspecified_carries_a_distinct_prompt_phrase():
    """三种非像素画风在管线里同走一条路,只有提示词能把它们分开。"""
    phrases = [s.prompt_phrase for s in ArtStyle if s is not ArtStyle.UNSPECIFIED]
    assert all(phrases)
    assert len(set(phrases)) == len(phrases)
    assert ArtStyle.UNSPECIFIED.prompt_phrase == ""


# -- 入参约束 ----------------------------------------------------------------


@pytest.mark.parametrize(
    "free_text, expected",
    [("低饱和像素风", "pixel"), ("中世纪厚涂", "中世纪厚涂")],
)
def test_legacy_free_text_still_creates_a_project(auth_client, free_text, expected):
    """还没换成下拉的客户端仍在发自由文本,拒掉会让它们建不了项目。

    认得出像素的归到枚举码;认不出的原样留着 —— 压成 NULL 会把用户的画风约束抹掉。
    """
    created = auth_client.post(
        "/projects", json=_payload(game_style=free_text)
    ).json()["data"]
    assert created["game_style"] == expected


def test_created_project_reports_the_chosen_style(auth_client):
    created = auth_client.post(
        "/projects", json=_payload(game_style="pixel")
    ).json()["data"]
    assert created["game_style"] == "pixel"


def test_unspecified_is_stored_as_null(auth_client):
    """现有前端把这一列原样显示,写字面量会让「不指定」四个字变成 unspecified。"""
    created = auth_client.post("/projects", json=_payload()).json()["data"]
    assert created["game_style"] is None


# -- 改画风 ------------------------------------------------------------------


def test_patch_can_change_style_without_renaming(auth_client):
    created = auth_client.post(
        "/projects", json=_payload(project_name="原名")
    ).json()["data"]

    body = auth_client.patch(
        f"/projects/{created['id']}", json={"game_style": "cartoon"}
    ).json()

    assert body["code"] == 200
    assert body["data"]["game_style"] == "cartoon"
    assert body["data"]["project_name"] == "原名"


def test_patch_with_no_field_is_rejected(auth_client):
    created = auth_client.post("/projects", json=_payload()).json()["data"]
    resp = auth_client.patch(f"/projects/{created['id']}", json={})
    assert resp.json()["code"] == 400


# -- 落到生成约束 ------------------------------------------------------------


@pytest.mark.parametrize(
    "stored, stylize, phrase",
    [
        ("pixel", "pixel", "pixel art"),
        ("cartoon", "none", ArtStyle.CARTOON.prompt_phrase),
        ("像素风格", "pixel", "像素风格"),
        (None, "none", ""),
    ],
)
def test_constraints_follow_the_project_style(db_session, stored, stylize, phrase):
    from windup_app.server.orchestrator.executor import _load_constraints
    from windup_app.server.project.model import Project

    project = Project(
        user_id=1,
        project_name=f"约束-{stored}",
        character_perspective=1,
        directional_movement=1,
        sprite_width=64,
        sprite_height=64,
        game_style=stored,
    )
    db_session.add(project)
    db_session.flush()

    cons = _load_constraints(db_session, project.id)
    assert cons.stylize == stylize
    assert cons.style == phrase


# -- 「没传」与「显式不指定」是两件事 ------------------------------------------


def test_patch_to_unspecified_actually_clears_the_style(auth_client, db_session):
    """把画风改回「不指定」必须真的落库,否则接口回成功而生成仍走旧约束。"""
    from windup_app.server.orchestrator.executor import _load_constraints
    from windup_app.server.project.model import Project

    created = auth_client.post(
        "/projects", json=_payload(game_style="pixel")
    ).json()["data"]
    assert _load_constraints(db_session, created["id"]).stylize == "pixel"

    body = auth_client.patch(
        f"/projects/{created['id']}", json={"game_style": "unspecified"}
    ).json()

    assert body["code"] == 200
    db_session.expire_all()
    assert db_session.get(Project, created["id"]).game_style is None
    assert _load_constraints(db_session, created["id"]).stylize == "none"


def test_patch_without_game_style_leaves_it_alone(auth_client, db_session):
    """只改名时不能顺手把画风清掉 —— 哨兵要真的区分开这两种情况。"""
    from windup_app.server.project.model import Project

    created = auth_client.post(
        "/projects", json=_payload(project_name="原名", game_style="cartoon")
    ).json()["data"]

    auth_client.patch(f"/projects/{created['id']}", json={"project_name": "新名"})

    db_session.expire_all()
    project = db_session.get(Project, created["id"])
    assert project.project_name == "新名"
    assert project.game_style == "cartoon"


def test_patch_accepts_legacy_free_text(auth_client):
    """PATCH 不能比 POST 还严:还没换下拉的客户端仍在发自由文本。"""
    created = auth_client.post("/projects", json=_payload()).json()["data"]

    body = auth_client.patch(
        f"/projects/{created['id']}", json={"game_style": "低饱和像素风"}
    ).json()

    assert body["code"] == 200
    assert body["data"]["game_style"] == "pixel"


def test_a_non_pixel_legacy_style_still_reaches_the_prompt(auth_client, db_session):
    """枚举化之前「中世纪厚涂」是原样进提示词的;归到不指定等于静默删掉用户的约束。"""
    from windup_app.server.orchestrator.executor import _load_constraints
    from windup_app.server.project.model import Project

    created = auth_client.post(
        "/projects", json=_payload(game_style="中世纪厚涂")
    ).json()["data"]

    db_session.expire_all()
    assert db_session.get(Project, created["id"]).game_style == "中世纪厚涂"
    cons = _load_constraints(db_session, created["id"])
    assert cons.style == "中世纪厚涂"
    assert cons.stylize == "none"
