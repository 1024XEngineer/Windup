"""画风预设目录:建表字段 + 列表/写入接口。"""

from windup_app.server.style_preset.model import StylePreset


def _payload(**overrides):
    body = {
        "code": "pixel_mid",
        "name": "中像素",
        "kind": "pixel",
        "prompt": "pixel art",
        "sample_url": "https://cdn.windup.test/pixel-mid.png",
        "stylize": "pixel",
        "sprite_width": 64,
        "sprite_height": 64,
        "sort_order": 20,
    }
    body.update(overrides)
    return body


def test_create_and_list_enabled_presets_in_sort_order(auth_client):
    first = auth_client.post(
        "/style-presets",
        json=_payload(code="cartoon", name="卡通", kind="cartoon", stylize="none", sort_order=30),
    ).json()
    second = auth_client.post("/style-presets", json=_payload()).json()
    hidden = auth_client.post(
        "/style-presets",
        json=_payload(code="pixel_low", name="低像素", sort_order=10, enabled=0),
    ).json()

    assert first["code"] == 200
    assert second["code"] == 200
    assert hidden["code"] == 200
    assert second["data"]["sprite_width"] == 64
    assert second["data"]["sprite_height"] == 64
    assert second["data"]["sample_url"] == "https://cdn.windup.test/pixel-mid.png"

    listed = auth_client.get("/style-presets").json()
    assert listed["code"] == 200
    assert [item["code"] for item in listed["data"]] == ["pixel_mid", "cartoon"]
    assert listed["total"] == 2


def test_list_style_presets_requires_login(client):
    body = client.get("/style-presets").json()
    assert body["code"] == 401


def test_duplicate_code_returns_400(auth_client):
    auth_client.post("/style-presets", json=_payload())
    body = auth_client.post("/style-presets", json=_payload(name="另一个中像素")).json()
    assert body["code"] == 400
    assert body["message"] == "画风编码已存在"


def test_update_can_disable_and_drop_from_list(auth_client):
    created = auth_client.post("/style-presets", json=_payload()).json()["data"]
    patched = auth_client.patch(
        f"/style-presets/{created['id']}",
        json={"enabled": 0, "sprite_width": 128, "sprite_height": 128},
    ).json()
    assert patched["code"] == 200
    assert patched["data"]["enabled"] == 0
    assert patched["data"]["sprite_width"] == 128

    listed = auth_client.get("/style-presets").json()
    assert listed["data"] == []


def test_update_missing_preset_returns_404(auth_client):
    body = auth_client.patch("/style-presets/99999", json={"name": "不存在"}).json()
    assert body["code"] == 404


def test_update_rejects_explicit_null(auth_client):
    created = auth_client.post("/style-presets", json=_payload()).json()["data"]
    body = auth_client.patch(
        f"/style-presets/{created['id']}",
        json={"name": None},
    ).json()
    assert body["code"] == 400
    assert "不能为 null" in body["message"]
    persisted = auth_client.get("/style-presets").json()["data"][0]
    assert persisted["name"] == "中像素"


def test_style_preset_table_has_project_aligned_sprite_columns():
    assert StylePreset.__table__.c.sprite_width.name == "sprite_width"
    assert StylePreset.__table__.c.sprite_height.name == "sprite_height"
    assert StylePreset.__table__.c.sample_url.nullable is False
