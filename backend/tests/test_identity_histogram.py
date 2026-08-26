"""立绘身份直方图与站立 QC:背面跳过,换色低于 PerfectPixel 的 0.40 门槛。"""

from __future__ import annotations

from PIL import Image

from windup_ai_engine.slicing.identity import (
    IDENTITY_ERROR_SIM,
    PROFILE_FRONT_DRIFT,
    identity_similarity,
    inspect_standing_cell,
    is_back_facing,
)
from windup_common.directions import ActionDirection


def _blob(
    color: tuple[int, int, int, int],
    *,
    x: int,
    y: int,
    w: int,
    h: int,
    canvas: tuple[int, int] = (64, 96),
) -> Image.Image:
    im = Image.new("RGBA", canvas, (0, 0, 0, 0))
    for yy in range(y, y + h):
        for xx in range(x, x + w):
            im.putpixel((xx, yy), color)
    return im


def test_back_facing_matches_perfectpixel_north_family():
    assert is_back_facing(ActionDirection.NORTH)
    assert is_back_facing(ActionDirection.NORTH_EAST)
    assert is_back_facing("north_west")
    assert not is_back_facing(ActionDirection.EAST)
    assert not is_back_facing(ActionDirection.SOUTH_EAST)


def test_identical_sprites_score_near_one():
    im = Image.new("RGBA", (32, 32), (200, 40, 40, 255))
    assert identity_similarity(im, im) == 1.0


def test_recolored_sprite_falls_below_identity_error_sim():
    red = Image.new("RGBA", (32, 32), (200, 40, 40, 255))
    blue = Image.new("RGBA", (32, 32), (40, 40, 200, 255))
    assert identity_similarity(red, blue) < IDENTITY_ERROR_SIM


def test_opaque_master_skips_identity_and_facing_errors():
    south = Image.new("RGBA", (64, 96), (200, 40, 40, 255))
    east = Image.new("RGBA", (64, 96), (40, 40, 200, 255))
    insp = inspect_standing_cell(east, south, ActionDirection.EAST)
    assert insp.ok
    assert insp.identity_sim is None
    assert insp.errors == 0


def test_empty_cell_is_an_error():
    south = _blob((200, 40, 40, 255), x=20, y=20, w=24, h=56)
    empty = Image.new("RGBA", (64, 96), (0, 0, 0, 0))
    insp = inspect_standing_cell(empty, south, ActionDirection.EAST)
    assert not insp.ok
    assert any("empty or faint" in hint for hint in insp.hints)


def test_east_as_wide_as_south_is_front_drift():
    south = _blob((200, 40, 40, 255), x=20, y=20, w=24, h=56)
    front = _blob((200, 40, 40, 255), x=20, y=20, w=24, h=56)
    insp = inspect_standing_cell(front, south, ActionDirection.EAST)
    assert not insp.ok
    assert any("Never drift back toward a front view" in hint for hint in insp.hints)
    slim = _blob((200, 40, 40, 255), x=4, y=48, w=8, h=28)
    ok = inspect_standing_cell(slim, south, ActionDirection.EAST)
    assert ok.ok
    width_norm = 8 * (56 / 28)
    assert width_norm < PROFILE_FRONT_DRIFT * 24


def test_north_skips_identity_and_does_not_check_front_drift():
    south = _blob((200, 40, 40, 255), x=20, y=20, w=24, h=56)
    north = _blob((40, 40, 200, 255), x=20, y=20, w=24, h=56)
    insp = inspect_standing_cell(north, south, ActionDirection.NORTH)
    assert insp.ok
    assert insp.identity_sim is None


def test_recolored_transparent_east_fails_identity():
    south = _blob((200, 40, 40, 255), x=20, y=20, w=24, h=56)
    east = _blob((40, 40, 200, 255), x=4, y=48, w=8, h=28)
    insp = inspect_standing_cell(east, south, ActionDirection.EAST)
    assert not insp.ok
    assert insp.identity_sim is not None
    assert insp.identity_sim < IDENTITY_ERROR_SIM
    assert any("different-looking character" in hint for hint in insp.hints)
