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

    **入参恒为 bytes,不是 URL** —— 上游(strategy)手里只有母版 bytes,让每个调用点
    自己想办法弄出一个公网 URL 会把"对象存储"这件事扩散到整条管线。有的供应商接口
    只吃公网 URL(FAL 队列面全部如此),那是**该 provider 自己的适配问题**:它在
    构造时接一个 :class:`FirstFrameUploader`,在 provider 内部把 bytes 换成 URL。
    见 :class:`~.sufy.FalQueueVideoProvider`。
    """

    def i2v(
        self, first_frame: bytes, prompt: str, seconds: int = 5, size: str = "1280x720"
    ) -> bytes: ...


@runtime_checkable
class FirstFrameUploader(Protocol):
    """首帧 bytes → **公网可取的 URL**(给只吃 URL 的视频接口用)。

    为什么是一个 port 而不是直接在 provider 里写上传:framework 里"对象存储"是另一
    条独立的线(见 ``windup_framework.storage`` 与依赖里的 ``qiniu``),由组装层决定
    用哪个桶、什么有效期、要不要复用已有的图。provider 只声明"我需要一个 URL"。

    实现方必须保证:返回的 URL 对**供应商的服务器**可取(不是只对内网/本机可取),
    且在整个生成周期内有效(i2v 任务排队 + 生成常见数分钟)。
    """

    def upload(self, frame: bytes, content_type: str) -> str: ...


@runtime_checkable
class MatteProvider(Protocol):
    """主体抠图(rembg / u2net)—— 按主体抠,不抠颜色(浅色角色撞背景会抠穿)。"""

    def cutout(self, frame: bytes) -> bytes: ...
