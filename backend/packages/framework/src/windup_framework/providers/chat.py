"""Chat 能力 Provider 工厂。"""

from typing import Any

from windup_framework.config.provider import AIProviderSettings, settings
from windup_framework.gateway.chat import ChatGateway, build_chat_gateway


def create_chat_model(
    config: AIProviderSettings = settings,
    **kwargs: Any,
) -> ChatGateway:
    """创建带 Gateway 策略的 Chat 模型。

    协议适配仍由 LangChain 官方 ``ChatOpenAI`` 完成；Gateway 只负责
    route / retry / circuit / trace。
    """
    if not config.api_key.strip():
        raise ValueError("AI_API_KEY is required")
    if not (config.chat_model or config.model).strip():
        raise ValueError("AI_CHAT_MODEL is required")
    return build_chat_gateway(config=config, **kwargs)
