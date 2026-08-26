from __future__ import annotations

import hashlib
from io import BytesIO

import numpy as np
import pytest
from PIL import Image

from windup_app.server.pixel_perfect.reconstructor import (
    MAX_INPUT_BYTES,
    ReconstructorError,
    reconstruct_bytes,
)


def _encode(image: Image.Image) -> bytes:
    output = BytesIO()
    image.save(output, format="PNG")
    return output.getvalue()


def test_explicit_grid_rebuilds_one_color_per_output_cell() -> None:
    palette = np.array(
        [
            [0, 0, 0, 255],
            [220, 60, 50, 255],
            [50, 120, 210, 255],
            [240, 235, 220, 255],
        ],
        dtype=np.uint8,
    )
    indexes = np.fromfunction(lambda y, x: (x + y) % 4, (4, 4), dtype=int)
    logical = palette[indexes]
    source = Image.fromarray(logical, "RGBA").resize((32, 32), Image.Resampling.NEAREST)

    result = reconstruct_bytes(_encode(source), cols=4, rows=4, structure_colors=4)

    assert (result.width, result.height) == (4, 4)
    assert result.visible_color_count == 4
    with Image.open(BytesIO(result.png)) as decoded:
        np.testing.assert_array_equal(np.asarray(decoded.convert("RGBA")), logical)


def test_structure_color_count_does_not_cap_the_final_palette() -> None:
    palette = np.array(
        [
            [10, 20, 30, 255],
            [220, 60, 50, 255],
            [50, 120, 210, 255],
            [240, 235, 220, 255],
        ],
        dtype=np.uint8,
    )
    indexes = np.fromfunction(lambda y, x: (x + y) % 4, (4, 4), dtype=int)
    logical = palette[indexes]
    source = Image.fromarray(logical, "RGBA").resize((32, 32), Image.Resampling.NEAREST)

    result = reconstruct_bytes(_encode(source), cols=4, rows=4, structure_colors=2)

    assert result.visible_color_count == 4
    with Image.open(BytesIO(result.png)) as decoded:
        np.testing.assert_array_equal(np.asarray(decoded.convert("RGBA")), logical)


def test_dense_grid_color_reconstruction_stays_within_source_color_bounds() -> None:
    y, x = np.indices((64, 64))
    source = np.empty((64, 64, 4), dtype=np.uint8)
    source[:, :, 0] = 100 + x % 11
    source[:, :, 1] = 100 + y % 11
    source[:, :, 2] = 100 + (x + y) % 11
    source[:, :, 3] = 255

    result = reconstruct_bytes(
        _encode(Image.fromarray(source, "RGBA")),
        cols=36,
        rows=36,
        structure_colors=2,
    )

    with Image.open(BytesIO(result.png)) as decoded:
        channels = np.asarray(decoded.convert("RGB"))
    assert np.all((channels >= 100) & (channels <= 110))


def test_transparent_rgb_preserves_the_existing_reconstructor_result() -> None:
    source = np.zeros((16, 16, 4), dtype=np.uint8)
    source[:12, :, :] = (255, 0, 0, 255)
    source[12:, :, :] = (0, 0, 255, 0)

    result = reconstruct_bytes(
        _encode(Image.fromarray(source, "RGBA")),
        cols=1,
        rows=1,
        structure_colors=2,
    )

    with Image.open(BytesIO(result.png)) as decoded:
        assert decoded.convert("RGBA").getpixel((0, 0)) == (223, 0, 32, 255)


def test_reconstructor_matches_the_rust_benchmark_golden() -> None:
    y, x = np.indices((128, 128))
    group = ((x // 8) + (y // 8) * 3) % 32
    logical = np.empty((128, 128, 4), dtype=np.uint8)
    logical[:, :, 0] = (group * 47 + x * 3) % 256
    logical[:, :, 1] = (group * 29 + y * 5) % 256
    logical[:, :, 2] = (group * 71 + x + y) % 256
    logical[:, :, 3] = np.where((x + y) % 29 == 0, 0, 255)
    source = Image.fromarray(logical, "RGBA").resize(
        (1024, 1024), Image.Resampling.NEAREST
    )

    result = reconstruct_bytes(_encode(source), cols=128, rows=128, structure_colors=32)

    with Image.open(BytesIO(result.png)) as decoded:
        rgba = decoded.convert("RGBA").tobytes()
    assert hashlib.sha256(rgba).hexdigest() == (
        "c5308291f48eb22166c178ca518dc9e33f55ea7a1518fdf1667b456b440244b1"
    )


def test_reconstructor_accepts_jpeg_input() -> None:
    source = Image.new("RGB", (16, 16), (30, 80, 120))
    encoded = BytesIO()
    source.save(encoded, format="JPEG", quality=100, subsampling=0)

    result = reconstruct_bytes(encoded.getvalue(), cols=1, rows=1, structure_colors=2)

    assert (result.width, result.height) == (1, 1)
    with Image.open(BytesIO(result.png)) as decoded:
        assert decoded.format == "PNG"
        assert decoded.convert("RGBA").getpixel((0, 0))[3] == 255


@pytest.mark.parametrize("structure_colors", [1, 65])
def test_reconstructor_rejects_structure_colors_outside_bounds(
    structure_colors: int,
) -> None:
    source = _encode(Image.new("RGBA", (16, 16), (0, 0, 0, 255)))

    with pytest.raises(ReconstructorError, match="between 2 and 64"):
        reconstruct_bytes(source, cols=1, rows=1, structure_colors=structure_colors)


def test_reconstructor_rejects_a_grid_larger_than_the_source() -> None:
    source = _encode(Image.new("RGBA", (32, 32)))

    with pytest.raises(ReconstructorError, match="grid must be within source bounds"):
        reconstruct_bytes(source, cols=33, rows=32, structure_colors=16)


def test_reconstructor_rejects_a_dense_grid_before_large_allocations() -> None:
    source = _encode(Image.new("RGBA", (512, 512)))

    with pytest.raises(ReconstructorError, match="working set exceeds"):
        reconstruct_bytes(source, cols=512, rows=512, structure_colors=64)


def test_reconstructor_rejects_more_than_four_million_pixels_before_decoding() -> None:
    source = _encode(Image.new("RGBA", (2001, 2000)))

    with pytest.raises(ReconstructorError, match="maximum is 4000000 pixels"):
        reconstruct_bytes(source, cols=16, rows=16, structure_colors=16)


def test_reconstructor_rejects_oversized_encoded_input_before_inspection() -> None:
    source = b"not-an-image" + bytes(MAX_INPUT_BYTES)

    with pytest.raises(ReconstructorError, match="encoded input exceeds"):
        reconstruct_bytes(source, cols=1, rows=1, structure_colors=2)


def test_reconstructor_rejects_unsupported_image_format() -> None:
    encoded = BytesIO()
    Image.new("RGB", (16, 16)).save(encoded, format="GIF")

    with pytest.raises(ReconstructorError, match="input must be PNG or JPEG"):
        reconstruct_bytes(encoded.getvalue(), cols=1, rows=1, structure_colors=2)


def test_reconstructor_rejects_images_with_a_side_below_sixteen_pixels() -> None:
    source = _encode(Image.new("RGBA", (15, 16)))

    with pytest.raises(ReconstructorError, match="minimum side is 16px"):
        reconstruct_bytes(source, cols=1, rows=1, structure_colors=2)
