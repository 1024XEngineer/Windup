"""协议层的纯数据结构与接口。

一条规则:协议只知道字节怎么排,不发请求、不重试、不休眠。
请求的构造与响应的解析是纯函数;发请求、轮询节奏、失败处理归 adapter 与 gateway。
"""
from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Protocol

import httpx

from windup_framework.gateway.types import AdapterResult


@dataclass(frozen=True)
class HttpCall:
    """一次调用要发的全部内容。adapter 照着发,不再自己拼路径或补头。"""

    method: str
    path: str
    headers: Mapping[str, str] = field(default_factory=dict)
    body: Mapping[str, object] | None = None


@dataclass(frozen=True)
class VideoRequest:
    """图生视频的一次请求。首帧仍是 bytes —— 转成什么形状由协议面决定。"""

    model: str
    prompt: str
    seconds: int
    size: str
    mode: str
    first_frame: bytes
    #: 首帧的公网地址。**上传是 IO,协议层不做 IO**,所以由 provider 先传好再填进来;
    #: 只吃 URL 的协议面(veo)拿不到它就必须拒建单,不能退回 base64 —— 那条路是
    #: status=queued 之后到生成阶段才 failed,而费用可能已经产生。
    first_frame_url: str | None = None


class JobProtocol(Protocol):
    """建单 → 轮询 → 取结果。各协议面的差别只在路径、鉴权与字段名,形状同构。

    ``build_fetch`` 返回 ``None`` 表示该面的产物地址已在轮询响应里,无需再取一次;
    返回 ``HttpCall`` 的面把成败留到 ``parse_fetch`` 才揭晓,``parse_poll`` 的 ``ok``
    此时只表示轮询到此为止。
    """

    def build_submit(self, req: VideoRequest) -> HttpCall: ...

    def parse_submit(self, resp: httpx.Response) -> AdapterResult: ...

    def build_poll(self, job_id: str) -> HttpCall: ...

    def parse_poll(self, resp: httpx.Response, job_id: str) -> AdapterResult: ...

    def build_fetch(self, job_id: str) -> HttpCall | None: ...

    def parse_fetch(self, resp: httpx.Response, job_id: str) -> AdapterResult: ...
