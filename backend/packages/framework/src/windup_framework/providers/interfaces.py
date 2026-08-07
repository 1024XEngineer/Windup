"""AI 模型底层适配器接口(framework)—— behind interface,key 由 config 注入。

ai_engine 经这些接口调模型,不直接读 env、不锁死具体供应商 / 模型名(可 A/B 换)。
实测在用:图像 = gemini-flash-image;视频 = kling-v2-5-turbo(2026-07-27 端到端实测
到 completed;#53 早期"仅 o1 可用、v2-5-turbo 下架"的结论已被该实测推翻);抠图 = rembg。

本文件是接口契约(真);具体 HTTP 实现见 :mod:`.sufy`。
"""
from __future__ import annotations

from typing import Protocol, runtime_checkable


@runtime_checkable
class ImageProvider(Protocol):
    """文 + 参考图 → 图(视角规整 / 定妆 / 逐帧生成)。"""

    def gen_image(self, prompt: str, refs: list[bytes]) -> bytes: ...


@runtime_checkable
class VideoProvider(Protocol):
    """首帧图 + 动作 prompt → 视频(i2v,步态位移动作用)。"""

    def i2v(
        self, first_frame: bytes, prompt: str, seconds: int = 5, size: str = "1280x720"
    ) -> bytes: ...


@runtime_checkable
class MatteProvider(Protocol):
    """主体抠图(rembg / u2net)—— 按主体抠,不抠颜色(浅色角色撞背景会抠穿)。"""

    def cutout(self, frame: bytes) -> bytes: ...
