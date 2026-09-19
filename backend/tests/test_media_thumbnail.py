"""卡片缩略图生成与对象存储写入边界。"""

from io import BytesIO
from unittest.mock import Mock, patch

import pytest
from PIL import Image

from windup_app.server.media.model import MediaUploadInput
from windup_app.server.media.service import (
    InvalidThumbnailSourceError,
    ObjectStorageMediaService,
    build_card_thumbnail,
    card_thumbnail_key,
)
from windup_common.enums.media import MediaCategory


def _png(size: tuple[int, int], color=(225, 90, 70, 0)) -> bytes:
    output = BytesIO()
    Image.new("RGBA", size, color).save(output, format="PNG")
    return output.getvalue()


def _metadata(category: MediaCategory, data: bytes) -> MediaUploadInput:
    return MediaUploadInput(
        filename="character.png",
        content_type="image/png",
        size=len(data),
        category=category,
    )


def test_card_thumbnail_limits_long_edge_and_preserves_alpha():
    thumbnail = build_card_thumbnail(_png((1200, 800)))

    with Image.open(BytesIO(thumbnail)) as image:
        assert image.format == "WEBP"
        assert image.size == (640, 427)
        assert image.mode == "RGBA"
        assert image.getpixel((0, 0))[3] == 0


def test_card_thumbnail_does_not_enlarge_small_assets():
    thumbnail = build_card_thumbnail(_png((48, 32), color=(225, 90, 70, 255)))

    with Image.open(BytesIO(thumbnail)) as image:
        assert image.size == (48, 32)


def test_card_thumbnail_rejects_sources_over_the_pixel_budget(monkeypatch):
    import windup_app.server.media.service as media_service_module

    monkeypatch.setattr(media_service_module, "_CARD_THUMBNAIL_MAX_SOURCE_PIXELS", 4)

    with pytest.raises(InvalidThumbnailSourceError, match="像素尺寸"):
        build_card_thumbnail(_png((3, 2)))


def test_card_thumbnail_rejects_bytes_pillow_cannot_decode():
    with pytest.raises(InvalidThumbnailSourceError, match="无法安全生成缩略图"):
        build_card_thumbnail(b"not an image at all")


def test_card_thumbnail_key_is_a_predictable_sibling():
    assert (
        card_thumbnail_key("media/reference-image/character.source.png")
        == "media/reference-image/character.card.webp"
    )
    assert (
        card_thumbnail_key("media/outfit-preview/character.source")
        == "media/outfit-preview/character.card.webp"
    )
    assert card_thumbnail_key("media/reference-image/legacy.png") == (
        "media/reference-image/legacy.png"
    )


def test_reference_upload_writes_original_then_thumbnail(monkeypatch):
    import qiniu
    import windup_app.server.media.service as media_service_module

    data = _png((1200, 800))
    monkeypatch.setattr(
        media_service_module.storage_settings, "bucket_domain", "cdn.example.com"
    )
    monkeypatch.setattr(
        media_service_module.storage_settings, "bucket_name", "example-bucket"
    )
    monkeypatch.setattr(
        media_service_module,
        "uuid4",
        lambda: Mock(hex="asset-id"),
    )
    auth = Mock()
    auth.upload_token.side_effect = lambda _bucket, key: f"token:{key}"
    monkeypatch.setattr(qiniu, "Auth", Mock(return_value=auth))
    response = Mock(status_code=200)
    put_data = Mock(return_value=({"key": "uploaded"}, response))
    monkeypatch.setattr(qiniu, "put_data", put_data)

    result = ObjectStorageMediaService().upload(
        data,
        _metadata(MediaCategory.REFERENCE_IMAGE, data),
    )

    original_call, thumbnail_call = put_data.call_args_list
    assert thumbnail_call.args[0] == "token:media/reference-image/asset-id.card.webp"
    assert thumbnail_call.args[1] == "media/reference-image/asset-id.card.webp"
    assert thumbnail_call.kwargs["mime_type"] == "image/webp"
    assert original_call.args == (
        "token:media/reference-image/asset-id.source.png",
        "media/reference-image/asset-id.source.png",
        data,
    )
    assert original_call.kwargs["mime_type"] == "image/png"
    assert result.object_key == "media/reference-image/asset-id.source.png"


def test_non_image_reference_category_skips_thumbnail_generation(monkeypatch):
    import qiniu
    import windup_app.server.media.service as media_service_module

    monkeypatch.setattr(media_service_module.storage_settings, "bucket_domain", "cdn.example.com")
    monkeypatch.setattr(media_service_module.storage_settings, "bucket_name", "example-bucket")
    monkeypatch.setattr(media_service_module, "uuid4", lambda: Mock(hex="asset-id"))
    auth = Mock()
    auth.upload_token.return_value = "token"
    monkeypatch.setattr(qiniu, "Auth", Mock(return_value=auth))
    response = Mock(status_code=200)
    put_data = Mock(return_value=({"key": "uploaded"}, response))
    monkeypatch.setattr(qiniu, "put_data", put_data)
    data = b"glTF"

    result = ObjectStorageMediaService().upload(
        data,
        MediaUploadInput(
            filename="model.glb",
            content_type="model/gltf-binary",
            size=len(data),
            category=MediaCategory.REFERENCE_IMAGE,
        ),
    )

    put_data.assert_called_once()
    assert result.object_key.endswith(".glb")
    assert ".source." not in result.object_key


def test_thumbnail_upload_failure_cleans_original(monkeypatch):
    import qiniu
    import windup_app.server.media.service as media_service_module

    data = _png((1200, 800))
    monkeypatch.setattr(media_service_module.storage_settings, "bucket_domain", "cdn.example.com")
    monkeypatch.setattr(media_service_module.storage_settings, "bucket_name", "example-bucket")
    monkeypatch.setattr(media_service_module, "uuid4", lambda: Mock(hex="asset-id"))
    auth = Mock()
    auth.upload_token.return_value = "token"
    monkeypatch.setattr(qiniu, "Auth", Mock(return_value=auth))
    failed = Mock(status_code=500, text="failed")
    success = Mock(status_code=200)
    monkeypatch.setattr(
        qiniu,
        "put_data",
        Mock(side_effect=[({"key": "source"}, success), (None, failed)]),
    )
    bucket = Mock()
    bucket.delete.return_value = ({}, Mock(status_code=200))
    monkeypatch.setattr(qiniu, "BucketManager", Mock(return_value=bucket))

    with pytest.raises(RuntimeError, match="七牛上传失败"):
        ObjectStorageMediaService().upload(
            data,
            _metadata(MediaCategory.REFERENCE_IMAGE, data),
        )

    bucket.delete.assert_called_once_with(
        "example-bucket", "media/reference-image/asset-id.source.png"
    )


def test_delete_uses_qiniu_bucket_manager(monkeypatch):
    import qiniu
    import windup_app.server.media.service as media_service_module

    monkeypatch.setattr(media_service_module.storage_settings, "bucket_name", "example-bucket")
    monkeypatch.setattr(qiniu, "Auth", Mock(return_value=Mock()))
    bucket = Mock()
    bucket.delete.return_value = ({}, Mock(status_code=200))
    monkeypatch.setattr(qiniu, "BucketManager", Mock(return_value=bucket))

    ObjectStorageMediaService().delete("media/reference-image/asset.card.webp")

    bucket.delete.assert_called_once_with(
        "example-bucket", "media/reference-image/asset.card.webp"
    )


# 612 是七牛的「对象不存在」,清理路径重复调用不该炸;其余状态码必须抛出来,
# 否则缩略图上传失败后的回滚会静默留下孤儿原图。
@pytest.mark.parametrize("status_code", [200, 612])
def test_delete_tolerates_already_missing_objects(monkeypatch, status_code):
    import qiniu
    import windup_app.server.media.service as media_service_module

    monkeypatch.setattr(media_service_module.storage_settings, "bucket_name", "example-bucket")
    monkeypatch.setattr(qiniu, "Auth", Mock(return_value=Mock()))
    bucket = Mock()
    bucket.delete.return_value = ({}, Mock(status_code=status_code))
    monkeypatch.setattr(qiniu, "BucketManager", Mock(return_value=bucket))

    ObjectStorageMediaService().delete("media/reference-image/asset.card.webp")


def test_delete_raises_when_qiniu_rejects_the_request(monkeypatch):
    import qiniu
    import windup_app.server.media.service as media_service_module

    monkeypatch.setattr(media_service_module.storage_settings, "bucket_name", "example-bucket")
    monkeypatch.setattr(qiniu, "Auth", Mock(return_value=Mock()))
    bucket = Mock()
    bucket.delete.return_value = ({}, Mock(status_code=599, text="network error"))
    monkeypatch.setattr(qiniu, "BucketManager", Mock(return_value=bucket))

    with pytest.raises(RuntimeError, match="七牛删除失败: status=599"):
        ObjectStorageMediaService().delete("media/reference-image/asset.card.webp")


def test_action_frame_upload_does_not_write_a_thumbnail(monkeypatch):
    import qiniu
    import windup_app.server.media.service as media_service_module

    data = _png((1200, 800))
    monkeypatch.setattr(
        media_service_module.storage_settings, "bucket_domain", "cdn.example.com"
    )
    monkeypatch.setattr(
        media_service_module.storage_settings, "bucket_name", "example-bucket"
    )
    monkeypatch.setattr(
        media_service_module,
        "uuid4",
        lambda: Mock(hex="frame-id"),
    )
    auth = Mock()
    auth.upload_token.return_value = "token"
    monkeypatch.setattr(qiniu, "Auth", Mock(return_value=auth))
    response = Mock(status_code=200)
    put_data = Mock(return_value=({"key": "uploaded"}, response))
    monkeypatch.setattr(qiniu, "put_data", put_data)

    ObjectStorageMediaService().upload(
        data,
        _metadata(MediaCategory.ACTION_FRAME, data),
    )

    put_data.assert_called_once()


@patch("windup_app.web.api.character.media_service")
def test_delete_character_cleans_card_thumbnails(mock_media_service, monkeypatch, auth_client):
    import windup_app.server.character.cleanup as character_cleanup

    monkeypatch.setattr(
        character_cleanup.storage_settings,
        "bucket_domain",
        "https://cdn.windup.test",
    )
    project = auth_client.post(
        "/projects",
        json={
            "project_name": "缩略图清理",
            "directional_movement": 1,
            "sprite_width": 64,
            "sprite_height": 64,
        },
    ).json()["data"]
    created = auth_client.post(
        "/characters",
        json={
            "project_id": project["id"],
            "workflow_run_id": 434,
            "name": "待删除角色",
            "description": "验证对象清理",
            "reference_image_url": (
                "https://cdn.windup.test/media/reference-image/reference.source.png"
            ),
            "character_data": {
                "outfits": [
                    {
                        "id": "outfit-1",
                        "name": "常态",
                        "preview_url": (
                            "https://cdn.windup.test/media/outfit-preview/outfit.source.png"
                        ),
                        "actions": [
                            {
                                "id": "action-1",
                                "type": "idle",
                                "name": "待机",
                                "frame_count": 1,
                                "frames": [
                                    {
                                        "index": 0,
                                        "image_url": (
                                            "https://cdn.windup.test/media/action-frame/frame.png"
                                        ),
                                    }
                                ],
                            }
                        ],
                    }
                ]
            },
        },
    ).json()["data"]

    response = auth_client.delete(f"/characters/{created['id']}")

    assert response.json()["code"] == 200
    assert [call.args[0] for call in mock_media_service.delete.call_args_list] == [
        "media/reference-image/reference.source.png",
        "media/reference-image/reference.card.webp",
        "media/outfit-preview/outfit.source.png",
        "media/outfit-preview/outfit.card.webp",
        "media/action-frame/frame.png",
    ]
