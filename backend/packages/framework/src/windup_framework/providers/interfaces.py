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
    """首帧图 + 动作 prompt → 视频(i2v,步态位移动作用)。

    **入参恒为 bytes,不是 URL。** 上游(ai_engine.strategy)手里只有母版 bytes,而且它
    必须有 bytes —— ``master_check`` 预检、``master_prep`` 预处理、像素化锁色板全都读
    母版**像素**。让调用点改传 URL 的话,ai_engine 还得自己下载回 bytes 才能干活。

    某些供应商的接口只吃公网 URL。那属于**该 provider 自己的适配问题**:在 provider
    内部完成 bytes → URL 的转换(需要一个上传能力时由组装层注入),而不是把这个差异
    漏给上层。这样"用哪个厂商"不会改变 ai_engine 的一行代码。
    """

    def i2v(
        self, first_frame: bytes, prompt: str, seconds: int = 5, size: str = "1280x720"
    ) -> bytes: ...


@runtime_checkable
class FirstFrameUploader(Protocol):
    """首帧 bytes → **公网可取的 URL**(给只吃 URL 的 i2v 接口用,如 veo)。

    与 :class:`~windup_framework.providers.render3d.interfaces.ModelUploader` 形状相同、
    契约不同,故单列:这里是一张几十 KB 的 JPG,而 URL 只需要活到建单被上游取走为止。

    实现住在组装层(它要碰对象存储凭证),framework 只认这个 port —— 于是
    "换哪个厂商" 不会改 ai_engine 的一行代码。
    """

    def upload(self, first_frame: bytes, content_type: str) -> str: ...


@runtime_checkable
class MatteProvider(Protocol):
    """主体抠图(rembg / u2net)—— 按主体抠,不抠颜色(浅色角色撞背景会抠穿)。"""

    def cutout(self, frame: bytes) -> bytes: ...
