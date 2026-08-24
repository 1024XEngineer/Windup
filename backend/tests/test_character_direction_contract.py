"""CharacterData 的全方向结构与项目完整性合同。"""

import pytest

from windup_app.server.character.direction_validation import (
    validate_character_directions,
)
from windup_app.server.character.model import CharacterData


def _real_template(direction: str) -> dict:
    return {
        "direction": direction,
        "source_direction": None,
        "mirror_x": False,
        "image_url": f"https://example.com/{direction}.png",
    }


def _real_sequence(direction: str) -> dict:
    return {
        "direction": direction,
        "source_direction": None,
        "mirror_x": False,
        "frame_count": 1,
        "frames": [
            {
                "index": 0,
                "image_url": f"https://example.com/{direction}-0.png",
            }
        ],
    }


def _mirror_template(direction: str, source: str) -> dict:
    return {
        "direction": direction,
        "source_direction": source,
        "mirror_x": True,
        "image_url": None,
    }


def _mirror_sequence(direction: str, source: str) -> dict:
    return {
        "direction": direction,
        "source_direction": source,
        "mirror_x": True,
        "frame_count": 1,
        "frames": [],
    }


def _data(version: int, templates: list[dict], sequences: list[dict]) -> CharacterData:
    return CharacterData.model_validate(
        {
            "version": version,
            "templates": templates,
            "outfits": [
                {
                    "id": "default",
                    "name": "默认造型",
                    "actions": [
                        {
                            "id": "idle",
                            "type": "idle",
                            "name": "待机",
                            "frame_count": 1,
                            "frames": _real_sequence("east")["frames"],
                            "sequences": sequences,
                        }
                    ],
                }
            ],
        }
    )


def test_version_two_four_way_accepts_real_west_frames():
    directions = ["east", "west", "north", "south"]
    data = _data(
        2,
        [_real_template(direction) for direction in directions],
        [_real_sequence(direction) for direction in directions],
    )

    validate_character_directions(data, movement=2, require_complete=True)
    west = data.outfits[0].actions[0].sequences[1]
    assert west.direction == "west"
    assert west.source_direction is None
    assert west.mirror_x is False
    assert west.frames[0].image_url.endswith("west-0.png")


def test_version_two_four_way_mirror_is_readable_but_not_complete():
    data = _data(
        2,
        [_real_template("east"), _mirror_template("west", "east")],
        [_real_sequence("east"), _mirror_sequence("west", "east")],
    )

    validate_character_directions(data, movement=2, require_complete=False)
    with pytest.raises(ValueError, match="west"):
        validate_character_directions(data, movement=2, require_complete=True)


def test_version_one_west_mirror_round_trips_unchanged():
    payload = {
        "version": 1,
        "templates": [_real_template("east"), _mirror_template("west", "east")],
        "outfits": [],
    }

    data = CharacterData.model_validate(payload)

    assert data.model_dump() == payload


def test_version_two_single_keeps_east_to_west_mirror_compatibility():
    data = _data(
        2,
        [_real_template("east"), _mirror_template("west", "east")],
        [_real_sequence("east"), _mirror_sequence("west", "east")],
    )

    validate_character_directions(data, movement=1, require_complete=True)


def test_version_two_four_way_rejects_specification_external_real_direction():
    directions = ["east", "west", "north", "south", "north_east"]
    data = _data(
        2,
        [_real_template(direction) for direction in directions],
        [_real_sequence(direction) for direction in directions],
    )

    with pytest.raises(ValueError, match="north_east"):
        validate_character_directions(data, movement=2, require_complete=True)


def test_version_one_multi_direction_asset_is_readable_but_not_complete():
    data = CharacterData.model_validate(
        {
            "version": 1,
            "templates": [_real_template("east"), _mirror_template("west", "east")],
            "outfits": [],
        }
    )

    validate_character_directions(data, movement=2, require_complete=False)
    with pytest.raises(ValueError, match="旧版镜像资产"):
        validate_character_directions(data, movement=2, require_complete=True)


def test_version_one_single_asset_keeps_legacy_completeness():
    data = CharacterData.model_validate(
        {
            "version": 1,
            "templates": [_real_template("east"), _mirror_template("west", "east")],
            "outfits": [],
        }
    )

    validate_character_directions(data, movement=1, require_complete=True)


def test_version_two_single_rejects_non_east_real_direction():
    data = CharacterData.model_validate(
        {
            "version": 2,
            "templates": [_real_template("east"), _real_template("north")],
            "outfits": [],
        }
    )

    with pytest.raises(ValueError, match="north"):
        validate_character_directions(data, movement=1, require_complete=True)


def test_version_two_single_rejects_non_west_derived_direction():
    data = CharacterData.model_validate(
        {
            "version": 2,
            "templates": [_real_template("east"), _mirror_template("north", "east")],
            "outfits": [],
        }
    )

    with pytest.raises(ValueError, match="north"):
        validate_character_directions(data, movement=1, require_complete=True)


def test_version_two_four_way_reports_missing_action_direction_after_complete_templates():
    required = ["east", "west", "north", "south"]
    data = _data(
        2,
        [_real_template(direction) for direction in required],
        [_real_sequence(direction) for direction in required if direction != "west"],
    )

    with pytest.raises(ValueError, match="west"):
        validate_character_directions(data, movement=2, require_complete=True)


def test_version_two_four_way_rejects_specification_external_action_direction():
    required = ["east", "west", "north", "south"]
    data = _data(
        2,
        [_real_template(direction) for direction in required],
        [_real_sequence(direction) for direction in [*required, "north_east"]],
    )

    with pytest.raises(ValueError, match="north_east"):
        validate_character_directions(data, movement=2, require_complete=True)


def test_template_direction_cannot_derive_from_itself():
    with pytest.raises(ValueError, match="不能镜像自身"):
        CharacterData.model_validate(
            {
                "version": 1,
                "templates": [_mirror_template("west", "west")],
                "outfits": [],
            }
        )
