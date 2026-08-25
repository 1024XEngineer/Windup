from io import BytesIO

from PIL import Image


def _source_png() -> bytes:
    output = BytesIO()
    Image.new("RGBA", (32, 32), (42, 91, 160, 255)).save(output, format="PNG")
    return output.getvalue()


def test_reconstructs_an_uploaded_image_with_the_explicit_project_grid(
    auth_client,
) -> None:
    response = auth_client.post(
        "/tools/pixel-perfect/reconstruct",
        files={"file": ("source.png", _source_png(), "image/png")},
        data={"cols": "8", "rows": "8", "structure_colors": "16"},
    )

    assert response.status_code == 200
    assert response.headers["content-type"] == "image/png"
    assert response.headers["x-pixel-cols"] == "8"
    assert response.headers["x-pixel-rows"] == "8"
    with Image.open(BytesIO(response.content)) as result:
        assert result.size == (8, 8)
        assert result.mode == "RGBA"
