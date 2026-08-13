"""受限的服务端取图 —— 只允许拉自家对象存储，且限响应体大小。

为什么需要它（2026-08-10，机器审逮到）：``executor`` 原先直接
``httpx.get(input.reference_image_urls[0])``，而那个 URL 来自已认证请求的请求体。
服务端替调用方发起请求，等于把服务器当跳板：

- ``http://127.0.0.1:8000/...`` 打到自己身上，绕过鉴权中间件访问内网端点；
- 云环境的实例元数据服务（各家都是一个固定的 link-local 地址）会吐出临时凭证；
- 私网地址段可以拿来探测内网拓扑；
- 重定向能把一个看起来合法的域名换成上面任意一种，所以**必须禁跟随重定向**；
- 响应体无上限时，一个指向巨大文件的 URL 就能把 worker 的内存吃光。

设计取向是**白名单**而不是黑名单：黑名单要穷举 127/8、10/8、172.16/12、192.168/16、
169.254/16、::1、fc00::/7、以及各种十进制/八进制/IPv6-mapped 写法，漏一条就等于没做。
而这里的业务只需要拉自家 bucket 的图（母版与参考图都是先经 ``/media/upload`` 传上去的），
所以直接卡"必须是 ``storage_settings.download_base`` 前缀"。

代价：调用方不能再传外部图床链接。这是刻意的——真要支持，该走一个显式的"导入外部素材"
入口，在那里做完整的地址校验与配额，而不是让生成链路顺手具备任意 URL 抓取能力。
"""
from __future__ import annotations

import httpx

from windup_framework.config.storage import settings as storage_settings

__all__ = ["MAX_FETCH_BYTES", "FetchNotAllowed", "fetch_own_media"]

# 单张图的上限。母版是 1024² 级的 PNG（实测 860~970 KB），16 MiB 留了足够余量，
# 又不至于让一个恶意 URL 拖垮 worker 内存。
MAX_FETCH_BYTES = 16 * 1024 * 1024


class FetchNotAllowed(ValueError):
    """URL 不在允许范围内，或响应体超限。属调用方输入问题（4xx），不该重试。"""


def fetch_own_media(url: str, *, timeout: float = 30.0) -> bytes:
    """取自家对象存储上的一张图。非自家地址、重定向、超大响应一律拒绝。"""
    base = storage_settings.download_base
    if not base:
        raise FetchNotAllowed(
            "对象存储下载域名未配置（WINDUP_STORAGE_BUCKET_DOMAIN），无法校验来源"
        )
    if not url.startswith(f"{base}/"):
        raise FetchNotAllowed(
            f"只允许拉自家对象存储（{base}）上的素材，收到 {url[:80]!r}。"
            "外部图片请先经 POST /media/upload 传入。"
        )

    # follow_redirects=False：跟随重定向会让白名单失效 —— 自家域名返回 302 指向
    # 元数据服务，校验就白做了。自家 bucket 直读不需要重定向。
    with httpx.Client(timeout=timeout, follow_redirects=False) as client:
        with client.stream("GET", url) as resp:
            resp.raise_for_status()
            declared = resp.headers.get("content-length")
            if declared and int(declared) > MAX_FETCH_BYTES:
                raise FetchNotAllowed(
                    f"素材 {int(declared)} 字节，超过上限 {MAX_FETCH_BYTES}"
                )
            # Content-Length 可以缺失或撒谎，故边读边计数。
            chunks: list[bytes] = []
            total = 0
            for chunk in resp.iter_bytes():
                total += len(chunk)
                if total > MAX_FETCH_BYTES:
                    raise FetchNotAllowed(
                        f"素材超过上限 {MAX_FETCH_BYTES} 字节（已读 {total}）"
                    )
                chunks.append(chunk)
    return b"".join(chunks)
