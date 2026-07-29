"""视频模型官方客户端工厂。"""

from typing import Any

from openai import AsyncOpenAI

from windup_framework.config.provider import AIProviderSettings, settings


def create_video_client(
    config: AIProviderSettings = settings,
    **kwargs: Any,
) -> AsyncOpenAI:
    """创建 OpenAI-compatible 视频模型异步客户端。

    视频 API 往往是异步任务；客户端只提供官方 SDK 的请求能力，任务创建、
    轮询和结果处理由 ai_engine 按供应商协议编排。
    """
    return AsyncOpenAI(
        api_key=config.api_key or None,
        base_url=config.normalized_base_url,
        timeout=config.timeout,
        max_retries=config.max_retries,
        **kwargs,
    )
