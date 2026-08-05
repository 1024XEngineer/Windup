"""Playtest 核验记录 API 集成测试。"""


def _character_payload() -> dict:
    return {
        "project_id": 1,
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
                            "frame_count": 0,
                            "frames": [],
                        }
                    ],
                }
            ],
        },
    }


def test_save_and_read_current_inspection(client):
    character = client.post("/characters", json=_character_payload()).json()["data"]
    target = {
        "character_id": character["id"],
        "outfit_id": "default",
        "action_id": "idle",
    }

    missing = client.get("/playtest-inspections", params=target).json()
    assert missing["code"] == 404

    saved = client.post(
        "/playtest-inspections",
        json={**target, "status": "passed"},
    ).json()
    assert saved["code"] == 200
    assert saved["data"]["status"] == "passed"

    updated = client.post(
        "/playtest-inspections",
        json={**target, "status": "issues_found"},
    ).json()
    assert updated["data"]["id"] == saved["data"]["id"]
    assert updated["data"]["status"] == "issues_found"

    loaded = client.get("/playtest-inspections", params=target).json()
    assert loaded["data"]["status"] == "issues_found"


def test_rejects_an_inspection_for_an_unknown_action(client):
    character = client.post("/characters", json=_character_payload()).json()["data"]
    response = client.post(
        "/playtest-inspections",
        json={
            "character_id": character["id"],
            "outfit_id": "default",
            "action_id": "missing",
            "status": "passed",
        },
    )

    assert response.json()["code"] == 404
    assert response.json()["message"] == "动作不存在"
