"""按模型能力划分的 AI Provider:官方客户端工厂 + 能力接口 + SUFY 实现。"""

from windup_framework.config.provider import AIProviderSettings
from windup_framework.providers.chat import create_chat_model
from windup_framework.providers.image import create_image_client
from windup_framework.providers.interfaces import (
    ImageProvider,
    MatteProvider,
    VideoProvider,
)
from windup_framework.providers.matte import OnnxU2NetMatteProvider
from windup_framework.providers.sufy import SufyImageProvider, SufyVideoProvider
from windup_framework.providers.video import create_video_client

__all__ = [
    "AIProviderSettings",
    "create_chat_model",
    "create_image_client",
    "create_video_client",
    # 能力接口(ai_engine 依赖这些稳定契约)
    "ImageProvider",
    "VideoProvider",
    "MatteProvider",
    # 实现
    "SufyVideoProvider",
    "SufyImageProvider",
    "OnnxU2NetMatteProvider",
]
