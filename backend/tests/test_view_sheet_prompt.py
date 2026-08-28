"""四向 / 八向立绘 sheet 提示词:每个朝向与项目视角都有正文,非法值要炸。"""

from __future__ import annotations

import pytest

from windup_ai_engine.prompt import (
    build_oriented_first_frame_prompt,
    build_view_sheet_prompt,
    view_for_perspective,
)
from windup_ai_engine.prompt._md import load_section
from windup_common.directions import ActionDirection
from windup_common.models import CharacterView


def test_every_compass_direction_has_a_camera_section():
    for direction in ActionDirection:
        text = load_section("view_sheet.md", direction.value)
        assert len(text) > 40, f"{direction.value} 朝向节短得不像正文:{text!r}"


@pytest.mark.parametrize("view", list(CharacterView))
def test_every_project_view_has_an_elevation_section(view: CharacterView):
    text = load_section("view_sheet.md", f"elevation.{view.value}")
    assert "orthographic" in text


def test_build_locks_identity_then_camera():
    text = build_view_sheet_prompt(ActionDirection.EAST)
    assert text.index("FRONT-VIEW character master") < text.index("ninety-degree")
    assert "true side view" in text
    assert "Exactly one character" in text


def test_south_is_front_view_not_east_profile():
    south = build_view_sheet_prompt(ActionDirection.SOUTH)
    east = build_view_sheet_prompt(ActionDirection.EAST)
    assert "faces the viewer" in south
    assert "true side view" in east
    assert south != east


def test_top_down_and_side_elevations_differ():
    top = build_view_sheet_prompt(ActionDirection.NORTH, view=CharacterView.TOP_DOWN)
    side = build_view_sheet_prompt(ActionDirection.NORTH, view=CharacterView.SIDE)
    assert "thirty to forty-five degrees" in top
    assert "Eye-level camera" in side
    assert top != side


def test_extra_clause_appends_without_replacing_identity():
    text = build_view_sheet_prompt(
        ActionDirection.NORTH_EAST,
        extra="pixel art, limited palette",
    )
    assert text.endswith("pixel art, limited palette")
    assert "FRONT-VIEW character master" in text


def test_blank_extra_does_not_pad_the_prompt():
    bare = build_view_sheet_prompt(ActionDirection.NORTH)
    padded = build_view_sheet_prompt(ActionDirection.NORTH, extra="   ")
    assert bare == padded


def test_illegal_direction_or_view_raises():
    with pytest.raises(ValueError):
        build_view_sheet_prompt("eastt")
    with pytest.raises(ValueError):
        build_view_sheet_prompt(ActionDirection.EAST, view="topdown")


def test_first_frame_reuses_heading_lock_and_replaces_idle_pose():
    text = build_oriented_first_frame_prompt(
        ActionDirection.EAST,
        action_prompt="walk cycle first frame, left foot forward",
    )
    assert "already facing the requested compass heading" in text
    assert "FRONT-VIEW character master" not in text
    assert "ninety-degree" in text
    assert "walk cycle first frame, left foot forward" in text
    assert "Neutral idle standing pose" not in text
    assert text.endswith("walk cycle first frame, left foot forward")


def test_first_frame_blank_action_prompt_raises():
    with pytest.raises(ValueError, match="动作描述"):
        build_oriented_first_frame_prompt(ActionDirection.SOUTH, action_prompt="   ")


def test_view_for_perspective_maps_project_camera():
    assert view_for_perspective(1) is CharacterView.SIDE
    assert view_for_perspective(2) is CharacterView.TOP_DOWN
    assert view_for_perspective(3) is CharacterView.ISOMETRIC
    assert view_for_perspective(99) is CharacterView.SIDE
