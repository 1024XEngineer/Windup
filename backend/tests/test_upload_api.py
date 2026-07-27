"""图片上传接口测试:类型校验 + 大小上限(不连真实 Kodo)。"""

import io

from fastapi.testclient import TestClient

import windup_app.web.api.upload as upload_mod
from windup_app.bootstrap.app import create_app


class _FakeStorage:
    def upload(self, data: bytes, key: str, content_type: str) -> str:
        return f"https://cdn.example.com/{key}"


def _client(monkeypatch, max_bytes: int | None = None) -> TestClient:
    monkeypatch.setattr(upload_mod, "_storage", _FakeStorage())
    if max_bytes is not None:
        monkeypatch.setenv("WINDUP_MAX_UPLOAD_BYTES", str(max_bytes))
    return TestClient(create_app())


def test_upload_valid_image_ok(monkeypatch):
    c = _client(monkeypatch)
    resp = c.post(
        "/upload/image",
        files={"file": ("a.png", io.BytesIO(b"\x89PNG" + b"x" * 10), "image/png")},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["data"]["url"].endswith(".png")  # key 用白名单扩展名


def test_upload_rejects_non_image(monkeypatch):
    c = _client(monkeypatch)
    resp = c.post(
        "/upload/image",
        files={"file": ("a.txt", io.BytesIO(b"hello"), "text/plain")},
    )
    assert resp.json()["code"] != 0  # 统一响应体的错误码


def test_upload_rejects_oversized_body(monkeypatch):
    c = _client(monkeypatch, max_bytes=100)
    big = io.BytesIO(b"\x89PNG" + b"x" * 500)
    resp = c.post(
        "/upload/image",
        files={"file": ("big.png", big, "image/png")},
    )
    assert resp.json()["code"] != 0  # 超上限被拒
