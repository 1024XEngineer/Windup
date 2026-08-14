"""契约用例:实现真的满足 Protocol,且值对象不让坏状态存在。

``runtime_checkable`` 的 isinstance 只查成员在不在,查不出签名 —— 所以这里另外把签名
逐个对一遍。搬进产品仓时这些用例是"形状没走样"的唯一机器化证据。
"""
from __future__ import annotations

import inspect

import pytest

from windup_framework.providers.render3d import (
    ArtifactFormatError,
    AutoRigProvider,
    LocalSpriteRenderProvider,
    Model3DProvider,
    ModelUploader,
    PresetMotion,
    RiggedModel,
    SpriteRenderProvider,
    SpriteSequence,
    SpriteSheet,
    TencentAutoRigProvider,
    TencentCosModelUploader,
    TencentCredentials,
    TencentModel3DProvider,
)
from windup_framework.providers.render3d.interfaces import RigInfo

CREDS = TencentCredentials("id", "key")


class _Uploader:
    def upload(self, model: bytes, content_type: str) -> str:
        return "https://x/y"


def test_implementations_satisfy_their_protocols():
    assert isinstance(TencentModel3DProvider(CREDS), Model3DProvider)
    assert isinstance(TencentAutoRigProvider(_Uploader(), CREDS), AutoRigProvider)
    assert isinstance(LocalSpriteRenderProvider(), SpriteRenderProvider)
    assert isinstance(TencentCosModelUploader(CREDS), ModelUploader)
    assert isinstance(_Uploader(), ModelUploader)


def test_signatures_match_the_protocol():
    """签名逐个字对 —— Protocol 的 isinstance 查不出参数名/默认值变了。
    产品仓那边的调用点是按这些名字用关键字传的,改名就是破坏契约。"""
    pairs = [
        (Model3DProvider.image_to_3d, TencentModel3DProvider.image_to_3d),
        (AutoRigProvider.rig, TencentAutoRigProvider.rig),
        (SpriteRenderProvider.render, LocalSpriteRenderProvider.render),
        (ModelUploader.upload, TencentCosModelUploader.upload),
    ]
    for proto, impl in pairs:
        assert inspect.signature(proto) == inspect.signature(impl), proto.__qualname__


def test_bytes_in_bytes_out_is_the_contract():
    """三个 Protocol 的入参都是 bytes,不是 URL / 路径。
    照抄 VideoProvider 立的规矩:让每个调用点自己弄公网 URL 会把"对象存储"扩散到整条管线。
    """
    # 注意 ``from __future__ import annotations`` 让注解是字符串,不是类型对象 ——
    # 拿 `is bytes` 比会永远为假,而消息还会打印成 "应当是 bytes,现在是 bytes"(踩过)。
    sigs = {
        "image_to_3d": inspect.signature(Model3DProvider.image_to_3d).parameters["master"],
        "rig": inspect.signature(AutoRigProvider.rig).parameters["model"],
        "render": inspect.signature(SpriteRenderProvider.render).parameters["rigged_model"],
    }
    for name, param in sigs.items():
        assert param.annotation == "bytes", \
            f"{name} 的主入参应当是 bytes,现在是 {param.annotation!r}"


def test_autorig_requires_an_uploader_with_no_default():
    """构造不出一个"没有上传能力的绑骨 provider" —— 免得跑到线上才发现模型送不出去
    (那时任务已提交、积分已扣)。与 FalQueueVideoProvider 必须接 FirstFrameUploader 同构。"""
    assert inspect.signature(TencentAutoRigProvider).parameters["uploader"].default \
        is inspect.Parameter.empty
    with pytest.raises(TypeError):
        TencentAutoRigProvider()          # type: ignore[call-arg]


def test_rigged_model_rejects_a_bogus_format():
    RiggedModel(data=b"glTF", fmt="GLB")
    with pytest.raises(ArtifactFormatError):
        RiggedModel(data=b"x", fmt="OBJ")


def test_preset_motion_defaults_to_no_root_motion():
    assert PresetMotion("walk", 23).has_root_motion is False


def test_sprite_sheet_counts_frames_across_directions():
    seqs = (SpriteSequence("e", 0.0, (b"1", b"2")), SpriteSequence("w", 180.0, (b"3",)))
    sheet = SpriteSheet(clip="c", duration_s=1.0, sample_times=(0.0,), sequences=seqs,
                        rig=RigInfo(28, 1, 10, "root", "fbx"), available_clips={"c": 1.0})
    assert sheet.frame_count == 3
    assert len(seqs[0]) == 2


def test_sequence_repr_does_not_dump_frame_bytes():
    """一条序列是几十张 PNG。让它进 repr 会把日志和 pytest 的失败输出彻底冲掉。"""
    text = repr(SpriteSequence("e", 0.0, (b"\x89PNG" + b"\x00" * 5000,)))
    assert "frames" not in text and len(text) < 200
