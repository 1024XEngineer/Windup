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
    r = ModelRegistry.from_settings(_cfg(video_fallbacks="kling-v2-6"))
    assert r.chain(Scene.CHARACTER_IMAGE) == ("gemini-2.5-flash-image",)
    assert r.chain(Scene.CHARACTER_ACTION) == ("kling-v2-5-turbo", "kling-v2-6")
    assert r.family_of("kling-v2-6") is Family.VIDEO_INPUT_REFERENCE

def test_rejects_image_list_in_video_chain():
    with pytest.raises(RegistryError, match="family"):
        ModelRegistry.from_settings(_cfg(video_fallbacks="kling-video-o1"))

def test_rejects_unknown_model():
    with pytest.raises(RegistryError, match="未登记"):
        ModelRegistry.from_settings(_cfg(image_fallbacks="not-a-real-model"))

def test_empty_fallbacks_ok():
    r = ModelRegistry.from_settings(_cfg(image_fallbacks="", video_fallbacks=""))
    assert r.chain(Scene.CHARACTER_ACTION) == ("kling-v2-5-turbo",)
