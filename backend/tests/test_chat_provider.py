"""Chat provider：空凭据 / 空型号不得构造 ChatOpenAI。"""

import pytest

from windup_framework.config.provider import AIProviderSettings
from windup_framework.providers.chat import create_chat_model


def test_create_chat_model_rejects_missing_api_key():
    config = AIProviderSettings(api_key="", chat_model="gpt-4o-mini", model="")
    with pytest.raises(ValueError, match="AI_API_KEY"):
        create_chat_model(config)


def test_create_chat_model_rejects_empty_model():
    config = AIProviderSettings(api_key="test-key", chat_model="", model="")
    with pytest.raises(ValueError, match="AI_CHAT_MODEL"):
        create_chat_model(config)


def test_create_chat_model_prefers_chat_model_over_generic_model():
    config = AIProviderSettings(
        api_key="test-key",
        chat_model="gpt-4o-mini",
        model="should-not-use",
    )
    chat = create_chat_model(config)
    assert chat.model_name == "gpt-4o-mini"
