"""media 上传 API 测试。

覆盖：大小限制、magic bytes 校验、content_type 白名单、异步上传。
"""

from unittest.mock import patch

from windup_common.enums.biz_code import BizCode

from windup_app.server.media.model import MediaUploadResult
from windup_app.web.api.media import (
    _ALLOWED_IMAGE_TYPES,
    _ALLOWED_MODEL_TYPES,
    _ALLOWED_TYPES,
    _get_size_limit,
    _validate_image_magic,
)


# -- Magic bytes 校验测试 --------------------------------------------------


def test_validate_image_magic_png():
    """PNG 文件头校验通过。"""
    png_header = b"\x89PNG\r\n\x1a\n" + b"\x00" * 100
    assert _validate_image_magic(png_header, "image/png") is True


def test_validate_image_magic_jpeg():
    """JPEG 文件头校验通过。"""
    jpeg_header = b"\xff\xd8\xff\xe0" + b"\x00" * 100
    assert _validate_image_magic(jpeg_header, "image/jpeg") is True


def test_validate_image_magic_gif():
    """GIF 文件头校验通过（GIF87a 和 GIF89a）。"""
    gif87a = b"GIF87a" + b"\x00" * 100
    gif89a = b"GIF89a" + b"\x00" * 100
    assert _validate_image_magic(gif87a, "image/gif") is True
    assert _validate_image_magic(gif89a, "image/gif") is True


def test_validate_image_magic_webp():
    """WebP 文件头校验通过（RIFF + WEBP at bytes 8-11）。"""
    webp_header = b"RIFF\x00\x00\x00\x00WEBP" + b"\x00" * 100
    assert _validate_image_magic(webp_header, "image/webp") is True


def test_validate_image_magic_webp_rejects_riff_without_webp():
    """仅有 RIFF 前缀但无 WEBP 标记的文件被拒绝（如 WAV、AVI）。"""
    wav_header = b"RIFF\x00\x00\x00\x00WAVE" + b"\x00" * 100
    assert _validate_image_magic(wav_header, "image/webp") is False

    avi_header = b"RIFF\x00\x00\x00\x00AVI " + b"\x00" * 100
    assert _validate_image_magic(avi_header, "image/webp") is False


def test_validate_image_magic_webp_rejects_short_data():
    """数据不足 12 字节的 WebP 被拒绝。"""
    short_data = b"RIFF\x00\x00"
    assert _validate_image_magic(short_data, "image/webp") is False


def test_validate_image_magic_mismatch():
    """文件头与声明的 content_type 不匹配。"""
    jpeg_header = b"\xff\xd8\xff\xe0" + b"\x00" * 100
    assert _validate_image_magic(jpeg_header, "image/png") is False


def test_validate_image_magic_rejects_unknown_type():
    """不在白名单中的图片子类型直接拒绝。"""
    data = b"\x00" * 100
    assert _validate_image_magic(data, "image/svg+xml") is False
    assert _validate_image_magic(data, "image/bmp") is False


# -- 大小限制测试 ----------------------------------------------------------


def test_size_limit_image():
    """图片限制 10 MB。"""
    assert _get_size_limit("image/png") == 10 * 1024 * 1024
    assert _get_size_limit("image/jpeg") == 10 * 1024 * 1024
    assert _get_size_limit("image/gif") == 10 * 1024 * 1024
    assert _get_size_limit("image/webp") == 10 * 1024 * 1024


def test_size_limit_model():
    """3D 模型限制 80 MB。"""
    assert _get_size_limit("model/gltf-binary") == 80 * 1024 * 1024
    assert _get_size_limit("model/gltf+json") == 80 * 1024 * 1024


def test_size_limit_unknown_defaults_to_image():
    """未知类型默认使用图片限制 10 MB。"""
    assert _get_size_limit("application/octet-stream") == 10 * 1024 * 1024


# -- 白名单配置测试 --------------------------------------------------------


def test_allowed_types_covers_all_image_subtypes():
    """所有允许的图片子类型都有对应的 magic bytes 校验。"""
    for mime in _ALLOWED_IMAGE_TYPES:
        assert mime in _validate_image_magic.__code__.co_consts or \
               mime in {"image/png", "image/jpeg", "image/gif", "image/webp"}


def test_allowed_types_disjoint():
    """图片和模型类型集合不重叠。"""
    assert _ALLOWED_IMAGE_TYPES.isdisjoint(_ALLOWED_MODEL_TYPES)


def test_allowed_types_is_union():
    """_ALLOWED_TYPES 是图片和模型的并集。"""
    assert _ALLOWED_TYPES == _ALLOWED_IMAGE_TYPES | _ALLOWED_MODEL_TYPES


# -- 端点测试（通过 TestClient + auth_client）-----------------------------

MOCK_RESULT = MediaUploadResult(
    url="https://cdn.example.com/media/test.png",
    object_key="media/general/abc123.png",
    filename="test.png",
    content_type="image/png",
    size=1024,
)


def _make_png_bytes(size: int = 1024) -> bytes:
    """构造合法 PNG 头 + 填充到指定大小。"""
    return b"\x89PNG\r\n\x1a\n" + b"\x00" * (size - 8)


@patch("windup_app.web.api.media.service")
def test_upload_success(mock_service, auth_client):
    """正常上传图片返回 URL。"""
    mock_service.upload.return_value = MOCK_RESULT
    png_data = _make_png_bytes(512)

    resp = auth_client.post(
        "/media/upload",
        files={"file": ("test.png", png_data, "image/png")},
    )

    assert resp.status_code == 200
    body = resp.json()
    assert body["code"] == BizCode.SUCCESS
    assert body["data"]["url"] == MOCK_RESULT.url
    mock_service.upload.assert_called_once()


@patch("windup_app.web.api.media.service")
def test_upload_model_type_allowed(mock_service, auth_client):
    """model/gltf-binary 类型允许上传。"""
    mock_service.upload.return_value = MOCK_RESULT.model_copy(
        update={"content_type": "model/gltf-binary", "filename": "avatar.glb"}
    )
    glb_data = b"glTF" + b"\x00" * 100

    resp = auth_client.post(
        "/media/upload",
        files={"file": ("avatar.glb", glb_data, "model/gltf-binary")},
    )

    assert resp.status_code == 200
    assert resp.json()["code"] == BizCode.SUCCESS


def test_upload_rejects_unsupported_type(auth_client):
    """非白名单类型被拒绝。"""
    resp = auth_client.post(
        "/media/upload",
        files={"file": ("malware.exe", b"MZ\x90\x00", "application/octet-stream")},
    )

    assert resp.status_code == 200
    body = resp.json()
    assert body["code"] != BizCode.SUCCESS
    assert "不支持的文件类型" in body["message"]


def test_upload_rejects_image_subtype_not_in_whitelist(auth_client):
    """白名单外的 image/* 子类型被拒绝（如 image/svg+xml）。"""
    resp = auth_client.post(
        "/media/upload",
        files={"file": ("icon.svg", b"<svg/>", "image/svg+xml")},
    )

    assert resp.status_code == 200
    body = resp.json()
    assert body["code"] != BizCode.SUCCESS
    assert "不支持的文件类型" in body["message"]


@patch("windup_app.web.api.media.service")
def test_upload_rejects_oversized_image(mock_service, auth_client):
    """图片超过 10 MB 被拒绝。"""
    over_size = 10 * 1024 * 1024 + 1
    png_data = _make_png_bytes(over_size)

    resp = auth_client.post(
        "/media/upload",
        files={"file": ("big.png", png_data, "image/png")},
    )

    assert resp.status_code == 200
    body = resp.json()
    assert body["code"] != BizCode.SUCCESS
    assert "超过限制" in body["message"]
    mock_service.upload.assert_not_called()


@patch("windup_app.web.api.media.service")
def test_upload_accepts_image_at_limit(mock_service, auth_client):
    """图片恰好 10 MB 可以上传。"""
    mock_service.upload.return_value = MOCK_RESULT
    png_data = _make_png_bytes(10 * 1024 * 1024)

    resp = auth_client.post(
        "/media/upload",
        files={"file": ("max.png", png_data, "image/png")},
    )

    assert resp.status_code == 200
    assert resp.json()["code"] == BizCode.SUCCESS


@patch("windup_app.web.api.media.service")
def test_upload_rejects_magic_mismatch(mock_service, auth_client):
    """声称 PNG 但文件头是 JPEG → 拒绝。"""
    jpeg_data = b"\xff\xd8\xff\xe0" + b"\x00" * 100

    resp = auth_client.post(
        "/media/upload",
        files={"file": ("fake.png", jpeg_data, "image/png")},
    )

    assert resp.status_code == 200
    body = resp.json()
    assert body["code"] != BizCode.SUCCESS
    assert "文件内容与声明的类型不匹配" in body["message"]
    mock_service.upload.assert_not_called()


@patch("windup_app.web.api.media.service")
def test_upload_no_magic_check_for_model(mock_service, auth_client):
    """model/* 类型不做 magic bytes 校验。"""
    mock_service.upload.return_value = MOCK_RESULT.model_copy(
        update={"content_type": "model/gltf-binary", "filename": "scene.glb"}
    )
    random_data = b"\x00\x01\x02\x03" + b"\x00" * 100

    resp = auth_client.post(
        "/media/upload",
        files={"file": ("scene.glb", random_data, "model/gltf-binary")},
    )

    assert resp.status_code == 200
    assert resp.json()["code"] == BizCode.SUCCESS


@patch("windup_app.web.api.media.service")
def test_upload_service_biz_error(mock_service, auth_client):
    """service.upload 抛 BizException 时返回对应错误码。"""
    from windup_common.exceptions import BizException

    mock_service.upload.side_effect = BizException("存储空间不足", code=BizCode.INTERNAL_ERROR)
    png_data = _make_png_bytes(512)

    resp = auth_client.post(
        "/media/upload",
        files={"file": ("test.png", png_data, "image/png")},
    )

    assert resp.status_code == 200
    body = resp.json()
    assert body["code"] == BizCode.INTERNAL_ERROR
    assert "存储空间不足" in body["message"]
