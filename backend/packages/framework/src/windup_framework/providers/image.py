"""图片模型官方客户端工厂。"""

from typing import Any

from openai import AsyncOpenAI

from windup_framework.config.provider import AIProviderSettings, settings


def create_image_client(
    config: AIProviderSettings = settings,
    **kwargs: Any,
) -> AsyncOpenAI:
    """创建 OpenAI-compatible 图片模型异步客户端。

    客户端本身来自官方 ``openai`` SDK；这里仅统一注入 Windup 配置，不重新
    实现图片请求协议。具体模型的文生图、图生图参数由调用方按供应商 API 传入。
    """
    return AsyncOpenAI(
        api_key=config.api_key or None,
        base_url=config.normalized_base_url,
        timeout=config.timeout,
        max_retries=config.max_retries,
        **kwargs,
    )
