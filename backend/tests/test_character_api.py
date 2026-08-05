"""角色资产 API 集成测试。"""


def _character_payload(project_id: int) -> dict:
    return {
        "project_id": project_id,
        "character_data": {
            "version": 1,
            "outfits": [
                {
                    "id": "default",
                    "name": "默认造型",
                    "actions": [
                        {
                            "id": "idle",
                            "type": "idle",
                            "name": "待机",
                            "fps": 8,
                            "frame_count": 1,
                            "frames": [
                                {
                                    "index": 0,
                                    "image_url": "https://example.test/frame.png",
                                    "duration_ms": 125,
                                    "root_motion": {"dx": 2, "dy": 1},
                                }
                            ],
                        }
                    ],
                }
            ],
        },
    }


def test_update_moves_character_and_renames_nested_assets(client):
    created = client.post("/characters", json=_character_payload(1)).json()["data"]
    updated_tree = created["character_data"]
    updated_tree["outfits"][0]["name"] = "夜巡造型"
    updated_tree["outfits"][0]["actions"][0]["name"] = "举起灯笼"

    response = client.patch(
        f"/characters/{created['id']}",
        json={"project_id": 2, "character_data": updated_tree},
    )

    assert response.status_code == 200
    data = response.json()["data"]
    assert data["project_id"] == 2
    assert data["character_data"]["outfits"][0]["name"] == "夜巡造型"
    assert data["character_data"]["outfits"][0]["actions"][0]["name"] == "举起灯笼"
    frame = data["character_data"]["outfits"][0]["actions"][0]["frames"][0]
    assert frame["root_motion"] == {"dx": 2.0, "dy": 1.0}
