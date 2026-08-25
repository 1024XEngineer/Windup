"""角色资产删除时使用的对象存储键提取。"""

from windup_framework.config.storage import settings as storage_settings

from windup_app.server.character.model import Character
from windup_app.server.media.service import card_thumbnail_key


def extract_object_keys(character: Character) -> list[str]:
    """提取角色拥有的对象存储键，供单角色和项目级删除共用。"""
    prefix = storage_settings.download_base + "/"
    keys: list[str] = []
    seen: set[str] = set()

    def add_url(url: str | None, *, include_thumbnail: bool = False) -> None:
        if not url or not url.startswith(prefix):
            return
        key = url[len(prefix) :]
        if key not in seen:
            seen.add(key)
            keys.append(key)
        if include_thumbnail:
            thumbnail_key = card_thumbnail_key(key)
            if thumbnail_key not in seen:
                seen.add(thumbnail_key)
                keys.append(thumbnail_key)

    add_url(character.reference_image_url, include_thumbnail=True)

    data = character.character_data or {}
    for template in data.get("templates", []):
        add_url(template.get("image_url"))
    for outfit in data.get("outfits", []):
        add_url(outfit.get("preview_url"), include_thumbnail=True)
        for action in outfit.get("actions", []):
            frame_groups = [action.get("frames", [])]
            frame_groups.extend(
                sequence.get("frames", []) for sequence in action.get("sequences", [])
            )
            for frames in frame_groups:
                for frame in frames:
                    add_url(frame.get("image_url"))

    return keys
