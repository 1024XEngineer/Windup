"""动作预设:描述判据 + 只读接口。

描述那条用例是本组的重点:预设描述直通两条付费生成通路,写错了只能靠人看图发现,
而这里能让它在 CI 当场变红(Refs 1024XEngineer/Windup#309)。
"""

import pytest

from windup_ai_engine.prompt import ACTION_PRESETS


@pytest.mark.parametrize("preset", ACTION_PRESETS, ids=lambda p: p.type.value)
def test_preset_description_is_one_instant_not_a_sequence(preset):
    """多阶段描述是 #309 的直接成因,而它逐词都不违规 —— lint 的规则里没有一条管得着。

    静态模型收到"先 A 后 B"只能把两个阶段并排画成分解姿势图,于是一张母版上有多个
    人物;帧数、时长、成色全部正常,只有看图才看得出来。
    """
    for staging in ("然后", "接着", "再", "之后", "回到", "先"):
        assert staging not in preset.description, (
            f"预设 {preset.type.value} 的描述里出现了阶段连接词「{staging}」,"
            "它描述的是一段过程而不是一个瞬间"
        )


def test_list_action_presets_returns_every_preset(auth_client):
    response = auth_client.get("/action-presets")

    assert response.status_code == 200
    body = response.json()
    assert body["code"] == 200
    assert [item["type"] for item in body["data"]] == [p.type.value for p in ACTION_PRESETS]
    assert [item["description"] for item in body["data"]] == [
        p.description for p in ACTION_PRESETS
    ]
    assert [item["label"] for item in body["data"]] == [p.label for p in ACTION_PRESETS]
    assert [item["name"] for item in body["data"]] == [p.name for p in ACTION_PRESETS]


def test_list_action_presets_requires_login(client):
    """预设是产品文案,但接口不进白名单:未登录拿不到,与其余业务接口同一道门。"""
    body = client.get("/action-presets").json()

    assert body["code"] == 401
