"""kling v3 turbo 走 FAL 队列面。

它与 veo 同在一条协议面上,但两者的必填项完全不同 —— 分派给错了面,代价是一次已计费
的 400 或一次错档计费。下面每条都对应一个真实会花钱的坏例。
"""
from __future__ import annotations

import io

import pytest
from PIL import Image

from windup_framework.gateway.registry import FAMILIES, ModelRegistry
from windup_framework.gateway.types import Family, Scene
from windup_framework.providers.protocol import (
    FAL_VIDEO_ENDPOINTS,
    KlingQueueVideoProtocol,
    UnknownFalEndpointError,
    VeoQueueVideoProtocol,
    fal_video_protocol,
)
from windup_framework.providers.protocol.types import VideoRequest

MODEL = "kling-v3-turbo-std"


def _png() -> bytes:
    buf = io.BytesIO()
    Image.new("RGBA", (64, 64), (20, 40, 200, 255)).save(buf, "PNG")
    return buf.getvalue()


def _call(model: str = MODEL):
    proto = fal_video_protocol(model, "k", base_url="https://api.qnaigc.com")
    return proto, proto.build_submit(
        VideoRequest(model=model, prompt="向右走", seconds=5, size="1280x720",
                     mode="std", first_frame=_png())
    )


def test_kling_v3_turbo_is_registered_on_the_fal_queue_face():
    """拦的坏例:去 OpenAI /videos 面找它。

    2026-08-27 实测那条面上 ``kling-v3-turbo`` 与 ``kling-v3-turbo-std`` 都报
    ``model not found or disabled``,只有 ``kling-v3``(另一个产品)在。
    """
    assert FAMILIES[MODEL] is Family.VIDEO_FAL_QUEUE
    assert FAL_VIDEO_ENDPOINTS[MODEL] == "fal-ai/kling-video/v3/turbo/std/image-to-video"


def test_kling_does_not_get_the_veo_protocol_face():
    """拦的坏例:同一条 family 一律给 veo 的面。

    veo 那条面有四个必填项与"首帧必须是公网 URL"的硬约束,kling 一个都不适用;
    给错了面,建单会被 400 拒,而那时首帧已经白传一次。
    """
    proto, _ = _call()
    assert isinstance(proto, KlingQueueVideoProtocol)
    assert not isinstance(proto, VeoQueueVideoProtocol)
    assert isinstance(fal_video_protocol("veo3.1", "k",
                                         base_url="https://api.qnaigc.com"),
                      VeoQueueVideoProtocol)


def test_duration_is_pinned_so_the_upstream_default_cannot_pick_the_tier():
    """拦的坏例:不发 duration,听上游默认档。

    默认档要是 10s 就是双倍价,而任务照常成功、没有一道会红。取值形态也钉住:
    kling 这条是**无后缀**的 ``"5"``,veo 那条是 ``"4s"`` —— 形状不同,别互相抄。
    """
    _, call = _call()
    assert call.body["duration"] == "5"
    assert not str(call.body["duration"]).endswith("s")


def test_first_frame_goes_out_as_base64_not_a_public_url():
    """kling 不需要先把首帧传对象存储。

    2026-08-27 实测十余次以 base64 建单成片。少一次上传就少一处会坏的地方,
    而 veo 那条面反过来 —— 两条面的这个约定相反,故各自有用例钉住。
    """
    _, call = _call()
    assert str(call.body["image_url"]).startswith("data:image/jpeg;base64,")


def test_submit_path_carries_the_model_because_the_body_does_not():
    """FAL 面的型号由**路径**表达,请求体里没有 model 字段 —— 路径错了就发去了别的型号。"""
    _, call = _call()
    assert call.path.endswith("/queue/fal-ai/kling-video/v3/turbo/std/image-to-video")
    assert "model" not in call.body


def test_an_unregistered_model_raises_before_any_request_goes_out():
    """拦的坏例:没登记的型号静默回落到某个默认端点,把单发给了别的型号。"""
    with pytest.raises(UnknownFalEndpointError, match="没有登记"):
        fal_video_protocol("kling-v9-imaginary", "k", base_url="https://api.qnaigc.com")


def test_kling_v3_turbo_can_serve_as_the_default_chain_model():
    """它面向所有用户,不是按用户授权的型号,所以必须能进兜底链。"""
    from windup_framework.config.provider import AIProviderSettings

    chain = ModelRegistry.from_settings(
        AIProviderSettings(base_url="https://api.qnaigc.com/v1", api_key="k",
                           video_model=MODEL, video_fallbacks="")
    ).chain(Scene.CHARACTER_ACTION)
    assert chain == (MODEL,)
