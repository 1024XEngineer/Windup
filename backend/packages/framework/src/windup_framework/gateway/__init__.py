"""AI Gateway 的按需导出入口。"""

from importlib import import_module

__all__ = [
    "AIGatewayAttempt",
    "AIGatewayAttemptDetail",
    "ChatGateway",
    "ImageGateway",
    "VideoGateway",
    "bind_call_context",
    "fresh_gateway_request",
    "build_chat_gateway",
    "build_image_gateway",
    "build_video_gateway",
]

_EXPORTS = {
    "AIGatewayAttempt": ("windup_framework.gateway.models", "AIGatewayAttempt"),
    "AIGatewayAttemptDetail": (
        "windup_framework.gateway.models",
        "AIGatewayAttemptDetail",
    ),
    "ChatGateway": ("windup_framework.gateway.chat", "ChatGateway"),
    "ImageGateway": ("windup_framework.gateway.image", "ImageGateway"),
    "VideoGateway": ("windup_framework.gateway.video", "VideoGateway"),
    "bind_call_context": ("windup_framework.gateway.context", "bind_call_context"),
    "fresh_gateway_request": (
        "windup_framework.gateway.context",
        "fresh_gateway_request",
    ),
    "build_chat_gateway": ("windup_framework.gateway.chat", "build_chat_gateway"),
    "build_image_gateway": ("windup_framework.gateway.image", "build_image_gateway"),
    "build_video_gateway": (
        "windup_framework.gateway.video",
        "build_video_gateway",
    ),
}


def __getattr__(name: str):
    try:
        module_name, attribute = _EXPORTS[name]
    except KeyError as exc:
        raise AttributeError(name) from exc
    value = getattr(import_module(module_name), attribute)
    globals()[name] = value
    return value
