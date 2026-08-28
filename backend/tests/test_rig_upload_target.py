"""绑骨的模型上传走**我们自己的**对象存储,不走腾讯 COS。

拦的坏例:18MB 的模型死在 ``ssl.sendall``,资产永远建不成。

2026-08-28 在生产部署机上实测的链路：

    部署机 → 腾讯 COS         64KB 通(52MB/s) │ 256KB 超时 │ 1MB BrokenPipe
    部署机 → 自家对象存储      1MB 0.32s
    部署机 → 上游 API 网关     1MB 0.23s

只有 COS 这一条超过约 64KB 就断。失败发生在 ``_upload``、``_submit`` 从没执行 ——
所以不扣费,但也永远建不成资产,而错误信息是一句 ``URLError: write operation timed
out``,看不出是哪条链路。

换成自家存储还顺带省掉一次 18MB 上传:``_publish_model`` 本来就要把模型传到同一个
地方,原先等于同一份文件传两遍、第二遍还传到一条走不通的链路上。
"""
from __future__ import annotations

import pytest


def test_the_rig_uploader_is_not_the_cos_one():
    """拦的坏例:退回 ``TencentCosModelUploader``。

    判据是**实际注入的那个对象的类型**,不是源码里有没有某个名字 —— 后者在把
    import 挪个位置时就会误判。
    """
    from windup_app.server.orchestrator import render3d_service as svc

    calls = []

    class _FakeProvider:
        def __init__(self, uploader, *, allow_spend=False):
            calls.append(uploader)

        def rig(self, model, *, want="GLB", motion=None):
            return object()

    import windup_framework.providers.render3d as r3d
    real = r3d.TencentAutoRigProvider
    r3d.TencentAutoRigProvider = _FakeProvider
    try:
        svc._LazyAutoRig(allow_spend=False).rig(b"x", motion="walk")
    finally:
        r3d.TencentAutoRigProvider = real

    assert calls, "没构造 provider"
    assert type(calls[0]).__name__ != "TencentCosModelUploader", (
        "又走回腾讯 COS 了 —— 生产部署机到 COS 的上行超过约 64KB 就断"
    )
    assert isinstance(calls[0], svc._MediaModelUploader)


def test_the_uploader_returns_a_public_http_url():
    """绑骨服务器要能取到这个 URL。

    ``TencentAutoRigProvider._upload`` 自己也会校验(非 http(s) 就在提交前炸),
    这条钉的是我们这一侧真的给得出。
    """
    from windup_app.server.orchestrator import render3d_service as svc

    seen = {}

    class _FakeMedia:
        def upload(self, data, spec):
            seen["filename"] = spec.filename
            seen["category"] = spec.category
            seen["size"] = spec.size
            return "https://media.example.com/media/model-3d/abc.glb"

    import windup_app.server.media.service as ms
    real = ms.service
    ms.service = _FakeMedia()
    try:
        url = svc._MediaModelUploader().upload(b"glTF" + b"\0" * 100, "model/gltf-binary")
    finally:
        ms.service = real

    assert url.startswith("https://")
    assert seen["category"] == "model-3d", "分类错了会走回 MediaCategory 那个老坑(#834②)"
    assert seen["size"] == 104, "size 要报真实字节数"


@pytest.mark.parametrize(
    "ct,want",
    [("model/gltf-binary", ".glb"), ("application/x-fbx", ".fbx")],
)
def test_the_filename_extension_follows_the_content_type(ct, want):
    """后缀跟着 content-type 走。

    绑骨接口按 ``Type`` 判格式、而两个出帧台宿主按 URL 后缀挑 loader ——
    FBX 挂成 .glb 会走 GLTFLoader 报 "Bad glTF"(#834③)。
    """
    from windup_app.server.orchestrator.render3d_service import _MediaModelUploader

    assert _MediaModelUploader._NAME[ct].endswith(want)
