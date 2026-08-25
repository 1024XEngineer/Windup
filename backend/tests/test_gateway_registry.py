import pytest
from windup_framework.config.provider import AIProviderSettings
from windup_framework.gateway.registry import ModelRegistry, RegistryError
from windup_framework.gateway.types import Family, Scene

def _cfg(**kw) -> AIProviderSettings:
    return AIProviderSettings(
        image_model="gemini-2.5-flash-image",
        video_model="kling-v2-5-turbo",
        **kw,
    )

def test_default_chains():
    r = ModelRegistry.from_settings(_cfg(video_fallbacks="kling-v2-6", image_fallbacks=""))
    assert r.chain(Scene.CHARACTER_IMAGE) == ("gemini-2.5-flash-image",)
    assert r.chain(Scene.CHARACTER_ACTION) == ("kling-v2-5-turbo", "kling-v2-6")
    assert r.family_of("kling-v2-6") is Family.VIDEO_INPUT_REFERENCE


def test_shipped_image_chain_is_gpt_image_2_then_gemini_flash():
    """出厂默认必须是这两个型号,且它们分属两个协议面。

    只断言配置字段的值不够:链是 registry 从配置拼出来的,而 registry 会因为型号未登记
    或 family 不合法而拒绝 —— 拒绝时抛的是构造期异常,配置本身看着仍然是对的。
    """
    r = ModelRegistry.from_settings(AIProviderSettings())
    assert r.chain(Scene.CHARACTER_IMAGE) == (
        "gpt-image-2",
        "gemini-3.1-flash-image-preview",
    )
    assert r.family_of("gpt-image-2") is Family.IMAGE_OPENAI_IMAGES
    assert r.family_of("gemini-3.1-flash-image-preview") is Family.IMAGE_FAL_QUEUE


def test_image_chain_may_mix_protocol_families():
    """主备分属不同协议面是合法配置,适配形状差异是 provider 的事。"""
    r = ModelRegistry.from_settings(
        AIProviderSettings(
            image_model="gpt-image-2",
            video_model="kling-v2-5-turbo",
            image_fallbacks="gemini-2.5-flash-image",
        )
    )
    assert r.chain(Scene.CHARACTER_IMAGE) == ("gpt-image-2", "gemini-2.5-flash-image")


def test_rejects_image_model_in_video_chain():
    """真正要拦的是类别错误:把出图型号配进视频链。"""
    with pytest.raises(RegistryError, match="family"):
        ModelRegistry.from_settings(_cfg(video_fallbacks="gpt-image-2"))

def test_rejects_image_list_in_video_chain():
    with pytest.raises(RegistryError, match="family"):
        ModelRegistry.from_settings(_cfg(video_fallbacks="kling-video-o1"))

def test_rejects_unknown_model():
    with pytest.raises(RegistryError, match="未登记"):
        ModelRegistry.from_settings(_cfg(image_fallbacks="not-a-real-model"))

def test_empty_fallbacks_ok():
    r = ModelRegistry.from_settings(_cfg(image_fallbacks="", video_fallbacks=""))
    assert r.chain(Scene.CHARACTER_ACTION) == ("kling-v2-5-turbo",)


def test_image_alt_can_be_fallback():
    r = ModelRegistry.from_settings(_cfg(image_fallbacks="gemini-2.5-flash-image-alt"))
    assert r.chain(Scene.CHARACTER_IMAGE) == (
        "gemini-2.5-flash-image",
        "gemini-2.5-flash-image-alt",
    )
    assert r.family_of("gemini-2.5-flash-image-alt") is Family.IMAGE_CHAT_DATA_URI
