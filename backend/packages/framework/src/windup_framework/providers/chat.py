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

    空 ``AI_API_KEY`` 或空型号直接拒绝，避免 langchain-openai 1.4 抛
    ``OpenAIError`` 或留下 ``ChatOpenAI(model="")``。
    """
    model = (config.chat_model or config.model or "").strip()
    api_key = (config.api_key or "").strip()
    if not api_key:
        raise ValueError("AI_API_KEY 未配置")
    if not model:
        raise ValueError("AI_CHAT_MODEL / AI_MODEL 未配置")
    return ChatOpenAI(
        model=model,
        api_key=api_key,
        base_url=config.normalized_base_url,
        timeout=config.timeout,
        max_retries=config.max_retries,
        **kwargs,
    )
