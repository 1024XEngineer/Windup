"""Chat 能力 Provider 工厂。"""

from typing import Any

from langchain_openai import ChatOpenAI

from windup_framework.config.provider import AIProviderSettings, settings


def create_chat_model(
    config: AIProviderSettings = settings,
    **kwargs: Any,
) -> ChatOpenAI:
    """创建 LangChain 官方 ``ChatOpenAI`` 实例。

    这里仅统一 Windup 配置到 LangChain 官方客户端的映射，不重新实现
    ``BaseChatModel``、消息转换、工具调用或结构化输出。
    """
    return ChatOpenAI(
        model=config.model,
        api_key=config.api_key or None,
        base_url=config.normalized_base_url,
        timeout=config.timeout,
        max_retries=config.max_retries,
        **kwargs,
    )
