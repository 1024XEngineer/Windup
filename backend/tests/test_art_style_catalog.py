"""画风预设目录:短语受措辞门禁管,档位不漏，前端从接口取而不是自己抄。"""

import pytest

from windup_ai_engine.prompt import ART_STYLE_PRESETS, phrase_for
from windup_ai_engine.prompt.lint import lint
from windup_common.enums import ArtStyle


def test_the_catalog_covers_every_style():
    """漏一档,那一档在菜单里就不存在 —— 而枚举仍然收它,于是只能靠手写请求才选得到。"""
    assert {p.style for p in ART_STYLE_PRESETS} == set(ArtStyle)


@pytest.mark.parametrize("preset", ART_STYLE_PRESETS, ids=lambda p: p.style.value)
def test_every_phrase_passes_the_prompt_gate(preset):
    """短语进的是母版那张静态图的提示词,和动作描述同一条付费通路。

    放进 ai_engine 而不是别处,图的就是这道门禁能看见它;不跑一遍等于白放。
    """
    errors = [i for i in lint(preset.phrase, kind="still") if i.level == "error"]
    assert errors == [], f"{preset.style.value}: {[i.message for i in errors]}"


def test_only_unspecified_has_an_empty_phrase():
    empty = [p.style for p in ART_STYLE_PRESETS if not p.phrase]
    assert empty == [ArtStyle.UNSPECIFIED]


def test_every_preset_says_what_the_user_would_see():
    """标签与说明都不能空:用户选画风时看不到管线,不说差别的话几档对他是等价的。"""
    assert all(p.label and p.hint for p in ART_STYLE_PRESETS)
    assert len({p.label for p in ART_STYLE_PRESETS}) == len(ART_STYLE_PRESETS)


def test_phrase_for_matches_the_catalog():
    assert all(phrase_for(p.style) == p.phrase for p in ART_STYLE_PRESETS)


# -- 接口 --------------------------------------------------------------------


def test_list_endpoint_returns_the_catalog(auth_client):
    body = auth_client.get("/art-styles").json()

    assert body["code"] == 200
    assert [item["code"] for item in body["data"]] == [
        p.style.value for p in ART_STYLE_PRESETS
    ]
    assert all(item["label"] and item["hint"] for item in body["data"])


def test_the_phrase_does_not_leave_the_backend(auth_client):
    """短语出网就等于邀请前端再抄一份 —— 那正是这次要消掉的那份副本。"""
    body = auth_client.get("/art-styles").json()

    assert all("phrase" not in item for item in body["data"])
