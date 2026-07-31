"""按模型能力划分的 AI Provider 接口。"""

from windup_framework.config.provider import AIProviderSettings
from windup_framework.providers.chat import create_chat_model
from windup_framework.providers.image import create_image_client
from windup_framework.providers.video import create_video_client

__all__ = [
    "AIProviderSettings",
    "create_chat_model",
    "create_image_client",
    "create_video_client",
]
