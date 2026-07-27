"""官方 AI 客户端工厂测试。"""

from langchain_openai import ChatOpenAI
from openai import AsyncOpenAI

from windup_framework.config.provider import AIProviderSettings, settings
from windup_framework.providers import (
    create_chat_model,
    create_image_client,
    create_video_client,
)


def test_settings_load_from_environment(monkeypatch):
    monkeypatch.setenv("AI_BASE_URL", "https://example.com/v1/")
    monkeypatch.setenv("AI_MODEL", "test-model")
    config = AIProviderSettings(_env_file=None)
    assert config.normalized_base_url == "https://example.com/v1"
    assert config.model == "test-model"


def test_factory_returns_official_langchain_chat_model():
    config = AIProviderSettings(
        _env_file=None,
        base_url="https://example.test/v1",
        api_key="secret",
        model="test-model",
        max_retries=3,
        timeout=30,
    )

    model = create_chat_model(config, temperature=0.7)

    assert isinstance(model, ChatOpenAI)
    assert model.model_name == "test-model"
    assert model.openai_api_key.get_secret_value() == "secret"
    assert str(model.openai_api_base) == "https://example.test/v1"
    assert model.max_retries == 3
    assert model.temperature == 0.7


def test_factory_model_keeps_langchain_capabilities():
    config = AIProviderSettings(_env_file=None, model="test-model", api_key="test-key")
    model = create_chat_model(config)

    assert callable(model.invoke)
    assert callable(model.ainvoke)
    assert callable(model.with_structured_output)
    assert callable(model.bind_tools)


def test_image_factory_returns_openai_async_client():
    config = AIProviderSettings(
        _env_file=None,
        base_url="https://image.example/v1",
        api_key="image-secret",
        model="image-model",
    )

    client = create_image_client(config)

    assert isinstance(client, AsyncOpenAI)
    assert client.api_key == "image-secret"
    assert str(client.base_url) == "https://image.example/v1/"


def test_video_factory_returns_openai_async_client():
    config = AIProviderSettings(
        _env_file=None,
        base_url="https://video.example/v1",
        api_key="video-secret",
        model="video-model",
    )

    client = create_video_client(config)

    assert isinstance(client, AsyncOpenAI)
    assert client.api_key == "video-secret"
    assert str(client.base_url) == "https://video.example/v1/"


def test_module_singleton_created():
    assert isinstance(settings, AIProviderSettings)
