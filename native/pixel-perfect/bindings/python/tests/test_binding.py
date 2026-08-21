from io import BytesIO

from PIL import Image
import pytest

import windup_pixel_perfect_native as native


def _png_bytes(width: int = 64, height: int = 64) -> bytes:
    logical = Image.new("RGBA", (16, 16))
    palette = [
        (30, 24, 20, 255),
        (210, 130, 70, 255),
        (235, 225, 200, 255),
        (70, 120, 135, 255),
    ]
    for y in range(16):
        for x in range(16):
            logical.putpixel((x, y), palette[(x * 7 + y * 11) % len(palette)])
    image = logical.resize((width, height), Image.Resampling.NEAREST)
    output = BytesIO()
    image.save(output, "PNG")
    return output.getvalue()


def test_binding_detects_the_six_field_grid_contract() -> None:
    result = native.detect(_png_bytes(), "full")

    assert set(result) == {
        "cols",
        "rows",
        "step_x",
        "step_y",
        "consensus",
        "confidence",
    }
    assert 15 <= result["cols"] <= 17
    assert 15 <= result["rows"] <= 17
    assert result["confidence"] in {"high", "medium", "low"}


def test_binding_reconstructs_an_explicit_grid_to_png_bytes() -> None:
    output = native.reconstruct(_png_bytes(), 16, 16, 4)
    image = Image.open(BytesIO(output))

    assert image.format == "PNG"
    assert image.size == (16, 16)


def test_binding_maps_invalid_input_to_value_error() -> None:
    with pytest.raises(ValueError, match="PNG or JPEG"):
        native.detect(b"not-an-image", "full")
