"""按模型能力划分的 AI Provider:官方客户端工厂 + 能力接口 + SUFY 实现。"""

from windup_framework.config.provider import AIProviderSettings
from windup_framework.gateway import bind_call_context, build_image_gateway, build_video_gateway
from windup_framework.providers.chat import create_chat_model
from windup_framework.providers.image import create_image_client
from windup_framework.providers.interfaces import (
    ImageProvider,
    MatteProvider,
    VideoProvider,
)
from windup_framework.providers.matte import OnnxU2NetMatteProvider
from windup_framework.providers.sufy import (
    SufyImageProvider,
    SufyVideoProvider,
)
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
    # FAL 队列面的 i2v(现役接口形态);首帧要公网 URL,故与 uploader 成对出现
    "SufyImageProvider",
    "OnnxU2NetMatteProvider",
    # Gateway 工厂(executor 从 windup_framework.gateway 取;此处再导出方便装配)
    "bind_call_context",
    "build_image_gateway",
    "build_video_gateway",
]
