"""可由多个上传入口复用的图片类型与文件头校验。"""

ALLOWED_IMAGE_TYPES: set[str] = {
    "image/png",
    "image/jpeg",
    "image/gif",
    "image/webp",
}

_IMAGE_SIGNATURES: dict[str, bytes] = {
    "image/png": b"\x89PNG\r\n\x1a\n",
    "image/jpeg": b"\xff\xd8\xff",
    "image/gif": b"GIF8",
}


def validate_image_magic(data: bytes | bytearray, content_type: str) -> bool:
    """校验文件头是否与声明的图片 MIME 类型匹配。"""
    if content_type == "image/webp":
        return len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP"
    expected = _IMAGE_SIGNATURES.get(content_type)
    return expected is not None and data[: len(expected)] == expected
