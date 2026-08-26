"""四向 / 八向立绘 sheet 提示词:每个朝向与项目视角都有正文,非法值要炸。"""

from __future__ import annotations

import pytest

from windup_ai_engine.prompt import build_view_sheet_prompt
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
    assert "overrides any other facing" in text
    assert "Never drift back toward a front view" in text


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


def test_pixel_stylize_appends_grid_clause_without_art_style_phrase():
    text = build_view_sheet_prompt(ActionDirection.EAST, stylize="pixel")
    assert "Chunky square pixels" in text
    assert "six to eight solid colors" in text
    assert "32-64px game sprite" in text
    assert "Art style" not in text
    bare = build_view_sheet_prompt(ActionDirection.EAST)
    assert "Chunky square pixels" not in bare


def test_source_directions_lock_pp_visibility():
    east = build_view_sheet_prompt(ActionDirection.EAST)
    north = build_view_sheet_prompt(ActionDirection.NORTH)
    south = build_view_sheet_prompt(ActionDirection.SOUTH)
    assert "left limbs fully hidden behind the body" in east
    assert "face completely hidden" in north
    assert "faces the viewer directly" in south
    assert "It supplies identity only" in east


def test_blank_extra_does_not_pad_the_prompt():
    bare = build_view_sheet_prompt(ActionDirection.NORTH)
    padded = build_view_sheet_prompt(ActionDirection.NORTH, extra="   ")
    assert bare == padded


def test_feedback_appends_after_extra_without_replacing_identity():
    text = build_view_sheet_prompt(
        ActionDirection.EAST,
        extra="idle stance",
        feedback="Never drift back toward a front view.",
    )
    assert text.endswith("Never drift back toward a front view.")
    assert text.index("FRONT-VIEW character master") < text.index("idle stance")
    assert text.index("idle stance") < text.index("Never drift back toward a front view.")
    bare = build_view_sheet_prompt(ActionDirection.EAST, extra="idle stance")
    assert "Never drift back toward a front view." not in bare


def test_illegal_direction_or_view_raises():
    with pytest.raises(ValueError):
        build_view_sheet_prompt("eastt")
    with pytest.raises(ValueError):
        build_view_sheet_prompt(ActionDirection.EAST, view="topdown")
